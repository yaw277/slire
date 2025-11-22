# Audit Trail Strategies with Tracing

Slire's built-in tracing functionality is specifically designed for two primary audit strategies: **change stream processing** (using the "latest" trace strategy) and **embedded audit trails** (using either "bounded" or "unbounded" trace strategies). The tracing feature automatically embeds trace context into documents during write operations, making it ideal for these approaches.

This document first covers these Slire-native strategies, followed by alternative approaches that implement audit logging without relying on Slire's tracing feature - giving you flexibility to choose based on your specific requirements and infrastructure.

## Change Stream Processing (Recommended)

**Approach:** Use MongoDB change streams to monitor document changes and build audit logs asynchronously from the embedded trace context.

```typescript
// Change stream processor
const changeStream = db
  .collection('expenses')
  .watch([{ $match: { 'fullDocument._trace': { $exists: true } } }]);

changeStream.on('change', async (event) => {
  const auditEntry = {
    entityId: event.fullDocument.id,
    entityType: 'expense',
    operation: event.operationType,
    trace: event.fullDocument._trace,
    timestamp: event.clusterTime,
    before: event.updateDescription ? await reconstructBefore(event) : null,
    after: event.fullDocument,
    changes: event.updateDescription?.updatedFields || null,
  };

  await auditCollection.insertOne(auditEntry);
});
```

**Pros:**

- Non-blocking write operations - audit processing doesn't slow down business operations
- Reliable event delivery with resume tokens for fault tolerance
- Natural separation of concerns - audit logic is completely separate from business logic
- Can reconstruct detailed before/after diffs from change stream data
- Scales well - change streams are MongoDB's recommended pattern for event processing

**Cons:**

- Eventual consistency - audit logs appear slightly after the actual operations
- Requires replica set deployment (not available in standalone MongoDB)
- Additional complexity in managing change stream processors
- Lost events if change stream processing fails (though can be resumed)

## Embedded Audit Trails

**Approach:** Use Slire's "bounded" or "unbounded" trace strategies to maintain operation history directly within each document.

```typescript
// Bounded strategy - limited history with size control
const boundedRepo = createMongoRepo({
  collection,
  mongoClient,
  traceContext: { userId, requestId, service: 'expense-api' },
  options: {
    traceStrategy: 'bounded',
    traceLimit: 100, // Keep last 100 operations per document
    traceKey: '_history',
  },
});

// Unbounded strategy - complete history without limits
const unboundedRepo = createMongoRepo({
  collection,
  mongoClient,
  traceContext: { userId, requestId, service: 'expense-api' },
  options: {
    traceStrategy: 'unbounded', // No traceLimit needed
    traceKey: '_history',
  },
});

// Normal operations automatically build audit history
await unboundedRepo.update(
  expenseId,
  { set: { status: 'approved', approver: 'john.doe' } },
  { mergeTrace: { operation: 'approve-expense', reason: 'manual-review' } }
);

// Document contains embedded audit trail
const expense = await repo.getById(expenseId);
console.log(expense._history);
// [
//   {
//     userId: 'john.doe',
//     requestId: 'req-123',
//     service: 'expense-api',
//     operation: 'approve-expense',
//     reason: 'manual-review',
//     _op: 'update',
//     _at: '2025-01-15T10:30:00Z'
//   },
//   // ... previous operations (up to traceLimit for bounded, unlimited for unbounded)
// ]

// Query documents by audit criteria using native MongoDB query
const recentApprovals = await repo.collection
  .find({
    _auditTrail: {
      $elemMatch: {
        operation: 'approve-expense',
        _at: { $gte: new Date('2025-01-01') },
      },
    },
  })
  .toArray();
```

**Database Support:**

- **MongoDB**: Both strategies supported
  - `bounded`: Uses `$push` with `$slice` for size limits
  - `unbounded`: Uses `$push` without size limits
- **Firestore**: `unbounded` only - `bounded` not supported due to lack of server-side array slicing
  - `unbounded`: Uses `FieldValue.arrayUnion()`

**Pros:**

- Zero external infrastructure - audit history travels with the document
- Immediate consistency - audit trail is always in sync with document state
- Simple querying - can filter documents by audit criteria directly
- No separate audit processing or storage concerns
- Complete history available (unbounded strategy)

**Cons:**

- Document size growth - larger documents impact performance and storage
- Limited history (bounded strategy only) - bounded by `traceLimit`
- Unbounded growth potential (unbounded strategy) - can lead to very large documents
- No global audit view - audit trail is scattered across individual documents
- Harder to implement complex audit analytics across multiple documents
- MongoDB 16MB document size limits apply to unbounded strategy

## Alternative: Synchronous Audit Collection

**Approach:** Write audit entries directly to a separate collection within the same transaction as the main operation.

```typescript
// Enhanced repository with synchronous audit
function createAuditedExpenseRepo(client: MongoClient, orgId: string) {
  // Note: baseRepo doesn't need tracing configuration since we handle audit separately
  const baseRepo = createExpenseRepo(client, orgId);
  const auditCollection = client.db('auditDb').collection('audit_log');

  return {
    ...baseRepo,
    async update(
      id: string,
      update: UpdateOperation<UpdateInput>,
      options?: { mergeTrace?: any }
    ) {
      return client.withSession(async (session) => {
        return session.withTransaction(async () => {
          // Create session-aware repository instance
          const txRepo = baseRepo.withSession(session);

          const before = await txRepo.getById(id);
          await txRepo.update(id, update, options);
          const after = await txRepo.getById(id);

          if (before && after) {
            // Audit insert happens within the same transaction
            await auditCollection.insertOne(
              {
                entityId: id,
                operation: 'update',
                trace: options?.mergeTrace,
                before,
                after,
                timestamp: new Date(),
              },
              { session }
            );
          }
        });
      });
    },
  };
}
```

**Pros:**

- Immediate consistency - audit entries are guaranteed when operations succeed
- Transactional integrity - audit writes succeed or fail with the main operation
- Complete before/after state capture is straightforward

**Cons:**

- Slower write operations due to additional database roundtrips
- Higher risk of operation failure - audit write failures can fail business operations
- More complex implementation for bulk operations
- Increased database load during write operations

## Alternative: Event-Driven Message Queue

**Approach:** Repository emits events to a message queue system for asynchronous audit processing.

```typescript
// Repository with event emission
function createEventEmittingRepo(
  client: MongoClient,
  orgId: string,
  messageQueue: MessageQueue
) {
  const baseRepo = createExpenseRepo(client, orgId);

  return {
    ...baseRepo,
    async create(entity: CreateInput, options?: { mergeTrace?: any }) {
      const id = await baseRepo.create(entity, options);

      // Emit audit event
      await messageQueue.publish('audit.expense.created', {
        entityId: id,
        trace: options?.mergeTrace || {},
        timestamp: new Date(),
        operation: 'create',
      });

      return id;
    },
    // Similar for update, delete...
  };
}

// Separate audit processor
messageQueue.subscribe('audit.*', async (event) => {
  // Fetch current document to get embedded trace
  const document = await collection.findOne({ id: event.entityId });

  await auditCollection.insertOne({
    ...event,
    fullTrace: document._trace,
    processed: new Date(),
  });
});
```

**Pros:**

- Completely decoupled - audit processing can't impact write operations
- High scalability - can handle high-volume operations with multiple consumers
- Flexible processing - different message types can have different audit handlers
- Reliable delivery with message queue guarantees

**Cons:**

- Additional infrastructure complexity (message queue, consumers)
- Potential message loss depending on queue configuration
- More moving parts to monitor and maintain
- Eventual consistency with possible gaps

## Alternative: Simple Event Emitter

**Approach:** Repository extends Node.js EventEmitter for lightweight in-process event handling.

```typescript
import { EventEmitter } from 'events';

// Repository with built-in event emission
function createEventEmittingRepo(client: MongoClient, orgId: string) {
  const baseRepo = createExpenseRepo(client, orgId);
  const eventEmitter = new EventEmitter();

  const enhancedRepo = {
    ...baseRepo,
    on: eventEmitter.on.bind(eventEmitter),
    emit: eventEmitter.emit.bind(eventEmitter),

    async create(entity: CreateInput, options?: { mergeTrace?: any }) {
      const id = await baseRepo.create(entity, options);

      // Emit event - fire and forget
      process.nextTick(() => {
        eventEmitter.emit('audit', {
          operation: 'create',
          entityId: id,
          entity,
          trace: options?.mergeTrace,
          timestamp: new Date(),
        });
      });

      return id;
    },

    async update(
      id: string,
      update: UpdateOperation<UpdateInput>,
      options?: { mergeTrace?: any }
    ) {
      await baseRepo.update(id, update, options);

      // Emit event
      process.nextTick(() => {
        eventEmitter.emit('audit', {
          operation: 'update',
          entityId: id,
          update,
          trace: options?.mergeTrace,
          timestamp: new Date(),
        });
      });
    },
    // Similar for delete...
  };

  return enhancedRepo;
}

// Usage - users can attach any handlers they want
const repo = createEventEmittingRepo(client, orgId);

// Simple logging
repo.on('audit', (event) => {
  console.log('Audit event:', event);
});

// Write to audit collection
repo.on('audit', async (event) => {
  await auditCollection.insertOne(event);
});

// Send notifications for critical operations
repo.on('audit', async (event) => {
  if (event.operation === 'delete') {
    await notificationService.sendAlert({
      message: `Document ${event.entityId} was deleted`,
      context: event.trace,
    });
  }
});
```

**Pros:**

- Minimal overhead - no external dependencies
- Complete flexibility - users attach whatever handlers they want
- Zero configuration - works out of the box
- Synchronous or asynchronous handling as needed

**Cons:**

- In-process only - doesn't survive application restarts
- No built-in reliability or retry mechanisms
- Memory usage grows with number of listeners
- Events lost if no listeners are attached

## Alternative: Application-Level Explicit Audit

**Approach:** Handle audit logic explicitly in business logic rather than automatically.

```typescript
// Business service with explicit audit
class ExpenseService {
  constructor(private repo: ExpenseRepo, private auditLog: AuditRepo) {}

  async approveExpense(id: string, approver: User): Promise<void> {
    const before = await this.repo.getById(id);
    if (!before) throw new Error('Expense not found');

    await this.repo.update(
      id,
      { set: { status: 'approved' } },
      {
        mergeTrace: {
          operation: 'approve-expense',
          approver: approver.id,
          reason: 'manual-approval',
        },
      }
    );

    const after = await this.repo.getById(id);

    await this.auditLog.create({
      entityId: id,
      entityType: 'expense',
      operation: 'approve',
      actor: approver.id,
      before: before,
      after: after,
      trace: after?._trace,
      businessContext: {
        approvalReason: 'manual-review-passed',
        workflow: 'standard-approval',
      },
    });
  }
}
```

**Pros:**

- Complete control over audit logic and data structure
- Rich business context can be captured beyond technical changes
- Explicit and visible - audit behavior is clear in the business logic
- Can implement different audit strategies for different operations

**Cons:**

- Easy to forget - no automatic audit trail generation
- Boilerplate code repeated across operations
- Tight coupling between business logic and audit requirements
- Higher risk of inconsistent audit practices across the codebase


