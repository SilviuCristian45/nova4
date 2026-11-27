import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStage2SyncChanges1768000000000 implements MigrationInterface {
  name = "AddStage2SyncChanges1768000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table public.sync_changes drop constraint if exists sync_changes_entity_type_check;
      alter table public.sync_changes
        add constraint sync_changes_entity_type_check check (entity_type in (
          'profile',
          'user_targets',
          'food',
          'workout',
          'meal',
          'meal_template',
          'daily_steps',
          'daily_weight',
          'daily_checkin',
          'progress_photo'
        ));
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_daily_checkin()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if tg_op = 'DELETE' then
          perform public.record_sync_change(old.user_id, 'daily_checkin', old.date::text, 'delete');
          return old;
        end if;
        perform public.record_sync_change(new.user_id, 'daily_checkin', new.date::text, 'upsert');
        return new;
      end;
      $$;

      create trigger sync_daily_checkin_after_change
        after insert or update or delete on public.daily_checkin
        for each row execute function public.trg_sync_daily_checkin();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_progress_photos()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if tg_op = 'DELETE' then
          perform public.record_sync_change(old.user_id, 'progress_photo', old.id::text, 'delete');
          return old;
        end if;
        perform public.record_sync_change(new.user_id, 'progress_photo', new.id::text, 'upsert');
        return new;
      end;
      $$;

      create trigger sync_progress_photos_after_change
        after insert or update or delete on public.progress_photos
        for each row execute function public.trg_sync_progress_photos();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop trigger if exists sync_progress_photos_after_change on public.progress_photos;`);
    await queryRunner.query(`drop function if exists public.trg_sync_progress_photos();`);
    await queryRunner.query(`drop trigger if exists sync_daily_checkin_after_change on public.daily_checkin;`);
    await queryRunner.query(`drop function if exists public.trg_sync_daily_checkin();`);
    await queryRunner.query(`delete from public.sync_changes where entity_type in ('daily_checkin', 'progress_photo');`);
    await queryRunner.query(`
      alter table public.sync_changes drop constraint if exists sync_changes_entity_type_check;
      alter table public.sync_changes
        add constraint sync_changes_entity_type_check check (entity_type in (
          'profile',
          'user_targets',
          'food',
          'workout',
          'meal',
          'meal_template',
          'daily_steps',
          'daily_weight'
        ));
    `);
  }
}
