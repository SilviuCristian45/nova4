import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";
import type { PhotoPose } from "@replog/shared";

@Entity({ name: "progress_photos" })
export class ProgressPhotoEntity {
  @PrimaryColumn({ type: "uuid" })
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "taken_on", type: "date" })
  takenOn: string;

  @Column({ type: "text", default: "front" })
  pose: PhotoPose;

  @Column({ type: "text", nullable: true })
  note: string | null;

  @Column({ type: "text", unique: true })
  path: string;

  @Column({ name: "size_bytes", type: "integer" })
  sizeBytes: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
