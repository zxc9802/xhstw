export type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
};

export interface ContentStorageGateway {
  headObject(key: string): Promise<{ contentType: string; size: number } | undefined>;
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  putJson(key: string, value: unknown): Promise<void>;
  getJson(key: string): Promise<unknown | undefined>;
  listKeys(prefix: string): Promise<string[]>;
  getObject(key: string): Promise<StoredObject | undefined>;
  deleteKeys(keys: string[]): Promise<void>;
}
