import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { UserEntity } from "./user.entity";

@Entity({ name: "coach_profiles" })
export class CoachProfileEntity {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId: string;

  @OneToOne(() => UserEntity, (user) => user.coachProfile, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: UserEntity;

  @Column({ name: "display_name", type: "text" })
  displayName: string;

  @Column({ type: "text", nullable: true })
  bio: string | null;

  @Column({ type: "text", array: true, default: () => "'{}'" })
  specialties: string[];

  @Column({ name: "is_public", type: "boolean", default: false })
  isPublic: boolean;

  @Column({ name: "accepting_clients", type: "boolean", default: true })
  acceptingClients: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
