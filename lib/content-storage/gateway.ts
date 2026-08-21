export type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
};

export interface ContentStorageGateway {
  createPutUrl(key: string, contentType: string): Promise<string>;
  headObject(key: string): Promise<{ contentType: string; size: number } | undefined>;
  putJson(key: string, value: unknown): Promise<void>;
  getJson(key: string): Promise<unknown | undefined>;
  listKeys(prefix: string): Promise<string[]>;
  getObject(key: string): Promise<StoredObject | undefined>;
  deleteKeys(keys: string[]): Promise<void>;
}
