import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "coach_client_notes" })
export class CoachClientNoteEntity {
  @PrimaryColumn({ name: "coach_id", type: "uuid" })
  coachId: string;

  @PrimaryColumn({ name: "client_id", type: "uuid" })
  clientId: string;

  @Column({ type: "text", default: "" })
  note: string;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
