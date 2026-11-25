import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CHECKIN_PHOTO_BUCKET, PHOTO_BUCKET } from "@replog/shared";

export interface PresignedUploadOptions {
  contentType?: string;
  contentLength?: number;
  expiresInSeconds?: number;
}

export interface ObjectHeadInfo {
  contentLength: number;
  contentType?: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly signingClient: S3Client;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>("S3_REGION") ?? "us-east-1";
    const endpoint = this.config.get<string>("S3_ENDPOINT")?.trim() || undefined;
    const publicEndpoint = this.config.get<string>("S3_PUBLIC_ENDPOINT")?.trim() || endpoint;
    const accessKeyId = this.config.get<string>("S3_ACCESS_KEY_ID") ?? "minioadmin";
    const secretAccessKey = this.config.get<string>("S3_SECRET_ACCESS_KEY") ?? "minioadmin";
    const forcePathStyleRaw = this.config.get<string>("S3_FORCE_PATH_STYLE");
    const forcePathStyle =
      forcePathStyleRaw !== undefined ? forcePathStyleRaw === "true" : Boolean(endpoint);

    const baseConfig: S3ClientConfig = {
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle,
    };

    this.client = new S3Client({
      ...baseConfig,
      ...(endpoint ? { endpoint } : {}),
    });

    this.signingClient =
      publicEndpoint && publicEndpoint !== endpoint
        ? new S3Client({ ...baseConfig, endpoint: publicEndpoint })
        : this.client;
  }

  getProgressPhotosBucket(): string {
    return this.config.get<string>("S3_BUCKET_PROGRESS_PHOTOS")?.trim() || PHOTO_BUCKET;
  }

  getCheckinPhotosBucket(): string {
    return this.config.get<string>("S3_BUCKET_CHECKIN_PHOTOS")?.trim() || CHECKIN_PHOTO_BUCKET;
  }

  async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.logger.log(`Created S3 bucket "${bucket}"`);
      } catch (err) {
        const name = (err as { name?: string })?.name ?? "";
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
          throw err;
        }
      }
    }
  }

  async createPresignedUploadUrl(
    bucket: string,
    key: string,
    options: PresignedUploadOptions = {},
  ): Promise<{ url: string; expiresIn: number }> {
    const expiresIn = options.expiresInSeconds ?? 600;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: options.contentType ?? "image/jpeg",
      ...(options.contentLength !== undefined ? { ContentLength: options.contentLength } : {}),
    });
    const url = await getSignedUrl(this.signingClient, command, { expiresIn });
    return { url, expiresIn };
  }

  async createPresignedDownloadUrl(bucket: string, key: string, expiresInSeconds = 600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.signingClient, command, { expiresIn: expiresInSeconds });
  }

  async createPresignedDownloadUrls(
    bucket: string,
    keys: readonly string[],
    expiresInSeconds = 600,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(keys.filter(Boolean))];
    const entries = await Promise.all(
      unique.map(async (key) => [key, await this.createPresignedDownloadUrl(bucket, key, expiresInSeconds)] as const),
    );
    return new Map(entries);
  }

  async headObject(bucket: string, key: string): Promise<ObjectHeadInfo | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        contentLength: result.ContentLength ?? 0,
        contentType: result.ContentType,
      };
    } catch (err) {
      const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (code === "NotFound" || code === "NoSuchKey" || status === 404) {
        return null;
      }
      throw err;
    }
  }

  async uploadObject(bucket: string, key: string, body: Buffer | Uint8Array, contentType = "image/jpeg"): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async downloadObject(bucket: string, key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) return null;
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (code === "NotFound" || code === "NoSuchKey" || status === 404) return null;
      throw err;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async deleteObjects(bucket: string, keys: readonly string[]): Promise<void> {
    const unique = [...new Set(keys.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 1000) {
      const chunk = unique.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  async deleteUserPrefix(bucket: string, userId: string): Promise<void> {
    const prefix = `${userId}/`;
    let continuationToken: string | undefined;

    for (;;) {
      let response;
      try {
        response = await this.client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
          }),
        );
      } catch (err) {
        const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (name === "NoSuchBucket" || status === 404) return;
        throw err;
      }

      const keys = (response.Contents ?? [])
        .map((obj) => obj.Key)
        .filter((key): key is string => Boolean(key));

      if (keys.length > 0) {
        await this.deleteObjects(bucket, keys);
      }

      if (!response.IsTruncated || !response.NextContinuationToken) return;
      continuationToken = response.NextContinuationToken;
    }
  }
}
