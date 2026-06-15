import { MongoClient } from "mongodb";
import { Session } from "@shopify/shopify-api";

type SessionDocument = ReturnType<Session["toObject"]>;

export class MongoSessionStorage {
  private client: MongoClient;
  private ready: Promise<void>;

  constructor(
    private dbUrl: string,
    private dbName: string,
    private collectionName = "shopify_sessions",
  ) {
    this.client = new MongoClient(dbUrl);
    this.ready = this.init();
  }

  async storeSession(session: Session) {
    await this.ready;
    await this.collection.findOneAndReplace(
      { id: session.id },
      session.toObject(),
      { upsert: true },
    );
    return true;
  }

  async loadSession(id: string) {
    await this.ready;
    const result = await this.collection.findOne({ id });
    return result ? new Session(result as any) : undefined;
  }

  async deleteSession(id: string) {
    await this.ready;
    await this.collection.deleteOne({ id });
    return true;
  }

  async deleteSessions(ids: string[]) {
    await this.ready;
    await this.collection.deleteMany({ id: { $in: ids } });
    return true;
  }

  async findSessionsByShop(shop: string) {
    await this.ready;
    const sessions = await this.collection.find({ shop }).toArray();
    return sessions.map((session) => new Session(session as any));
  }

  async disconnect() {
    await this.client.close();
  }

  private get collection() {
    return this.client.db(this.dbName).collection<SessionDocument>(
      this.collectionName,
    );
  }

  private async init() {
    await this.client.connect();
    await this.client.db(this.dbName).command({ ping: 1 });
  }
}
