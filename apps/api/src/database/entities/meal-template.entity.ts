import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "meal_templates" })
export class MealTemplateEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "text" })
  name: string;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  items: unknown[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
