import { CollectionReference } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { createSmartFirestoreRepo } from '../lib/firestore-repo';
import {
  clearFirestoreCollection,
  firestore,
  setupFirestore,
  teardownFirestore,
} from './firestore-fixture';

describe('createSmartFirestoreRepo', function () {
  jest.setTimeout(60 * 1000);
  const COLLECTION_NAME = 'generic_repo_test';

  beforeAll(async () => {
    await setupFirestore();
  });

  function testCollection(): CollectionReference<TestEntity> {
    return firestore.firestore.collection(
      COLLECTION_NAME
    ) as CollectionReference<TestEntity>;
  }

  function rawTestCollection(): CollectionReference<any> {
    return firestore.firestore.collection(COLLECTION_NAME);
  }

  beforeEach(async () => {
    await clearFirestoreCollection(COLLECTION_NAME);
  });

  afterAll(async () => {
    await clearFirestoreCollection(COLLECTION_NAME);
    await teardownFirestore();
  });

  describe('create', () => {
    it('should create a new entity and return its id', async () => {
      const repo = createSmartFirestoreRepo({
        collection: testCollection(),
        firestore: firestore.firestore,
      });
      const entity = createTestEntity({
        name: 'John Doe',
        email: 'john@example.com',
      });

      const createdId = await repo.create(entity);

      expect(typeof createdId).toBe('string');
      expect(createdId.length).toBeGreaterThan(0);

      // verify the entity was created
      const created = await repo.getById(createdId);
      expect(created).toMatchObject({
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should generate unique ids for different entities', async () => {
      const repo = createSmartFirestoreRepo({
        collection: testCollection(),
        firestore: firestore.firestore,
      });
      const entity1 = createTestEntity({ name: 'Entity 1' });
      const entity2 = createTestEntity({ name: 'Entity 2' });

      const id1Result = await repo.create(entity1);
      const id2Result = await repo.create(entity2);

      expect(id1Result).not.toEqual(id2Result);
    });

    it('should handle entities with optional fields', async () => {
      const repo = createSmartFirestoreRepo({
        collection: testCollection(),
        firestore: firestore.firestore,
      });
      const entity = createTestEntity({
        metadata: undefined,
      });

      const createdId = await repo.create(entity);

      const created = await repo.getById(createdId);
      expect(created).toEqual({
        id: createdId,
        tenantId: 'org123',
        name: 'Test User',
        email: 'test@example.com',
        age: 30,
        isActive: true,
      });
    });

    it('should recursively filter undefined properties (not store as null)', async () => {
      const repo = createSmartFirestoreRepo({
        collection: testCollection(),
        firestore: firestore.firestore,
      });
      const entity = createTestEntity({
        metadata: {
          tags: ['test', undefined as any, 'integration'],
          notes: undefined,
        },
      });

      const createdId = await repo.create(entity);

      // Check raw document in Firestore
      const rawDoc = await rawTestCollection().doc(createdId).get();
      const rawData = rawDoc.data();

      expect(rawData).toMatchObject({
        tenantId: 'org123',
        name: 'Test User',
        email: 'test@example.com',
        age: 30,
        isActive: true,
        metadata: {
          tags: ['test', 'integration'], // undefined filtered out from array
          // notes field should not exist at all (not set to null)
        },
      });
      expect(rawData?.metadata).not.toHaveProperty('notes');
    });

    it('should strip system-managed fields from input entities during create', async () => {
      const repo = createSmartFirestoreRepo({
        collection: testCollection(),
        firestore: firestore.firestore,
        options: {
          softDelete: true,
          version: true,
          traceTimestamps: true,
        },
        traceContext: { userId: 'test-user' },
      });
      const entityWithManagedFields = {
        ...createTestEntity(),
        _id: 'should-be-stripped',
        _version: 42,
        _createdAt: new Date('2023-01-01'),
        _updatedAt: new Date('2023-01-02'),
        _deleted: true,
        _trace: { userId: 'user123' },
      } as any;

      const createdId = await repo.create(entityWithManagedFields);

      // Check raw document in Firestore
      const rawDoc = await rawTestCollection().doc(createdId).get();
      const rawData = rawDoc.data();

      // Managed fields should not be present (stripped during create)
      expect(rawData).not.toHaveProperty('_id');
      expect(rawData).not.toHaveProperty('_version');
      expect(rawData).not.toHaveProperty('_createdAt');
      expect(rawData).not.toHaveProperty('_updatedAt');
      expect(rawData).not.toHaveProperty('_deleted');
      expect(rawData).not.toHaveProperty('_trace');

      // Business fields should be present
      expect(rawData).toMatchObject({
        tenantId: 'org123',
        name: 'Test User',
        email: 'test@example.com',
      });
    });

    it('should strip system-managed fields with custom timestamp keys during create', async () => {
      const repo = createSmartFirestoreRepo({
        collection: firestore.firestore.collection(
          COLLECTION_NAME
        ) as CollectionReference<TestEntityWithTimestamps>,
        firestore: firestore.firestore,
        options: {
          timestampKeys: {
            createdAt: 'createdAt',
            updatedAt: 'updatedAt',
          },
          traceTimestamps: true,
        },
      });

      const entityWithCustomTimestamps: TestEntityWithTimestamps = {
        ...createTestEntity(),
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-01-02'),
      };

      const createdId = await repo.create(entityWithCustomTimestamps);

      // Check raw document in Firestore
      const rawDoc = await rawTestCollection().doc(createdId).get();
      const rawData = rawDoc.data();

      // Custom timestamp fields should not be present from input (stripped and auto-managed)
      // But they will be set by the system with current timestamp
      expect(rawData).toHaveProperty('createdAt');
      expect(rawData).toHaveProperty('updatedAt');

      // The values should not be the ones from input (2023-01-01, 2023-01-02)
      // They should be recent timestamps set by the system
      const createdAt =
        (rawData as any).createdAt?.toDate?.() || rawData?.createdAt;
      const updatedAt =
        (rawData as any).updatedAt?.toDate?.() || rawData?.updatedAt;

      expect(createdAt).toBeInstanceOf(Date);
      expect(updatedAt).toBeInstanceOf(Date);
      expect(createdAt.getFullYear()).toBe(new Date().getFullYear()); // Should be current year
      expect(updatedAt.getFullYear()).toBe(new Date().getFullYear()); // Should be current year
    });
  });
});

// Test Entity type and helper function (same as MongoDB tests)
type TestEntity = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  age: number;
  isActive: boolean;
  metadata?: {
    tags: string[];
    notes?: string;
  };
  audit?: {
    [key: string]: any;
  };
};

type TestEntityWithTimestamps = TestEntity & {
  createdAt: Date;
  updatedAt: Date;
};

function createTestEntity(overrides: Partial<TestEntity> = {}): TestEntity {
  return {
    id: uuidv4(),
    tenantId: 'org123',
    name: 'Test User',
    email: 'test@example.com',
    age: 30,
    isActive: true,
    metadata: {
      tags: ['test', 'integration'],
      notes: 'Test entity for generic repo',
    },
    ...overrides,
  };
}
