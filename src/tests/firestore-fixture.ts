import { Firestore } from '@google-cloud/firestore';

// Firestore Emulator configuration
const FIRESTORE_HOST = 'localhost';
const FIRESTORE_PORT = 8080;
const PROJECT_ID = 'smart-repo-test';

class FirestoreFixture {
  private firestoreInstance?: Firestore;

  public get firestore(): Firestore {
    if (this.firestoreInstance) {
      return this.firestoreInstance;
    }
    throw new Error('Firestore not available, you need to run setup first');
  }

  public async setup() {
    if (!this.firestoreInstance) {
      // Setup function that can be raced with timeout
      const setupFirestore = async (): Promise<void> => {
        // Configure Firestore to use the emulator
        this.firestoreInstance = new Firestore({
          projectId: PROJECT_ID,
          host: FIRESTORE_HOST,
          port: FIRESTORE_PORT,
          ssl: false,
          customHeaders: {
            Authorization: 'Bearer owner',
          },
        });

        // Test connection by trying to get a dummy document
        await this.firestoreInstance
          .collection('_test')
          .doc('_connectivity')
          .get();
      };

      // Create timeout promise with cleanup
      let timeoutHandle: NodeJS.Timeout;
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error(
                'Setup timeout after 3 seconds - Firestore emulator may not be running. ' +
                  `Make sure it's running on ${FIRESTORE_HOST}:${FIRESTORE_PORT}. ` +
                  `Start it with: firebase emulators:start --only firestore --project=${PROJECT_ID}`
              )
            ),
          3000
        );
      });

      try {
        await Promise.race([setupFirestore(), timeout]);
        clearTimeout(timeoutHandle!); // Clear timeout if setup succeeds
      } catch (error) {
        clearTimeout(timeoutHandle!); // Clear timeout if setup fails too
        this.firestoreInstance = undefined; // Clear failed instance so teardown/clear operations are skipped
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        throw new Error(
          `Failed to connect to Firestore emulator: ${errorMessage}. ` +
            `Make sure it's running on ${FIRESTORE_HOST}:${FIRESTORE_PORT}. ` +
            `Start it with: firebase emulators:start --only firestore --project=${PROJECT_ID}`
        );
      }
    }
  }

  public async teardown() {
    if (this.firestoreInstance) {
      try {
        await this.firestoreInstance.terminate();
      } catch (error) {
        console.warn(
          'Firestore teardown failed:',
          error instanceof Error ? error.message : error
        );
        // Don't throw - teardown failures shouldn't break tests
      } finally {
        this.firestoreInstance = undefined; // Always clear instance
      }
    }
  }

  public async clearCollection(collectionName: string) {
    if (!this.firestoreInstance) {
      throw new Error('Firestore not available');
    }

    const batch = this.firestoreInstance.batch();
    const snapshot = await this.firestoreInstance
      .collection(collectionName)
      .get();

    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    if (snapshot.size > 0) {
      await batch.commit();
    }
  }
}

const fixture = new FirestoreFixture();
export const firestore = fixture as Omit<
  FirestoreFixture,
  'setup' | 'teardown'
>;
export const setupFirestore = () => fixture.setup();
export const teardownFirestore = () => fixture.teardown();
export const clearFirestoreCollection = (collectionName: string) =>
  fixture.clearCollection(collectionName);
