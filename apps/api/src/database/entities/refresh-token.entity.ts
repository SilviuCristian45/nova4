import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { UserEntity } from "./user.entity";

@Entity({ name: "refresh_tokens" })
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @ManyToOne(() => UserEntity, (user) => user.refreshTokens, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: UserEntity;

  @Column({ name: "token_hash", type: "text", unique: true })
  tokenHash: string;

  @Column({ name: "family_id", type: "uuid" })
  familyId: string;

  @Column({ name: "replaced_by_id", type: "uuid", nullable: true })
  replacedById: string | null;

  @Column({ name: "user_agent", type: "text", nullable: true })
  userAgent: string | null;

  @Column({ name: "ip_address", type: "text", nullable: true })
  ipAddress: string | null;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt: Date;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
