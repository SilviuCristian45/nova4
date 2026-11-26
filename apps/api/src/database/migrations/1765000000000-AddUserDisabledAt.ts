import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserDisabledAt1765000000000 implements MigrationInterface {
  name = "AddUserDisabledAt1765000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table public.users
        add column if not exists disabled_at timestamptz;
      create index if not exists users_disabled_at_idx
        on public.users (disabled_at)
        where disabled_at is not null;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      drop index if exists public.users_disabled_at_idx;
      alter table public.users
        drop column if exists disabled_at;
    `);
  }
}
