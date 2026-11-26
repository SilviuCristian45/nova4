import { Column, CreateDateColumn, Entity, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { ProfileEntity } from "./profile.entity";
import { CoachProfileEntity } from "./coach-profile.entity";
import { RefreshTokenEntity } from "./refresh-token.entity";

@Entity({ name: "users" })
export class UserEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "text" })
  email: string;

  @Column({ name: "password_hash", type: "text" })
  passwordHash: string;

  @Column({ name: "email_verified_at", type: "timestamptz", nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ name: "disabled_at", type: "timestamptz", nullable: true })
  disabledAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @OneToOne(() => ProfileEntity, (profile) => profile.user)
  profile?: ProfileEntity;

  @OneToOne(() => CoachProfileEntity, (coachProfile) => coachProfile.user)
  coachProfile?: CoachProfileEntity;

  @OneToMany(() => RefreshTokenEntity, (token) => token.user)
  refreshTokens?: RefreshTokenEntity[];
}
