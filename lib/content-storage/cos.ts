import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import type { ContentStorageGateway } from "./gateway";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function readCosConfig() {
  const region = required("TENCENT_COS_REGION");
  return {
    bucket: required("TENCENT_COS_BUCKET"),
    region,
    endpoint: `https://cos.${region}.myqcloud.com`,
    accessKeyId: required("TENCENT_COS_SECRET_ID"),
    secretAccessKey: required("TENCENT_COS_SECRET_KEY")
  };
}

function isNotFound(error: unknown) {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;
}

export class TencentCosGateway implements ContentStorageGateway {
  private readonly config = readCosConfig();
  private readonly client = new S3Client({
    region: this.config.region,
    endpoint: this.config.endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey
    }
  });

  async headObject(key: string) {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return { contentType: result.ContentType || "application/octet-stream", size: Number(result.ContentLength || 0) };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async putJson(key: string, value: unknown) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json; charset=utf-8"
    }));
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType
    }));
  }

  async getJson(key: string) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return JSON.parse(await result.Body!.transformToString());
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async listKeys(prefix: string) {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      keys.push(...(result.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []));
      continuationToken = result.NextContinuationToken;
    } while (continuationToken);
    return keys;
  }

  async getObject(key: string) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return {
        bytes: new Uint8Array(await result.Body!.transformToByteArray()),
        contentType: result.ContentType || "application/octet-stream"
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async deleteKeys(keys: string[]) {
    for (const key of [...new Set(keys)]) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    }
  }
}

let gateway: ContentStorageGateway | undefined;

export function getContentStorageGateway() {
  return gateway ??= new TencentCosGateway();
}

export function setContentStorageGatewayForTests(value?: ContentStorageGateway) {
  gateway = value;
}
