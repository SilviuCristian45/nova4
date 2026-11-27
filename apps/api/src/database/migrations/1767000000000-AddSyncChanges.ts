import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSyncChanges1767000000000 implements MigrationInterface {
  name = "AddSyncChanges1767000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table public.sync_changes (
        seq bigserial primary key,
        user_id uuid not null references public.users(id) on delete cascade,
        entity_type text not null check (entity_type in (
          'profile',
          'user_targets',
          'food',
          'workout',
          'meal',
          'meal_template',
          'daily_steps',
          'daily_weight'
        )),
        entity_id text not null,
        op text not null check (op in ('upsert', 'delete')),
        updated_at timestamptz not null default now(),
        unique (user_id, entity_type, entity_id)
      );
      create index sync_changes_user_seq_idx on public.sync_changes (user_id, seq asc);
    `);

    // Helper that records the latest monotonic sequence number per (user_id, entity_type, entity_id).
    // Uses a per-user advisory lock (salt 1001) so pull queries see linearizable sequences without gaps.
    await queryRunner.query(`
      create or replace function public.record_sync_change(
        p_user_id uuid,
        p_entity_type text,
        p_entity_id text,
        p_op text
      )
      returns void
      language plpgsql
      set search_path = ''
      as $$
      begin
        if p_user_id is null or p_entity_id is null then
          return;
        end if;
        if not exists (select 1 from public.users where id = p_user_id) then
          return;
        end if;

        perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1001));

        insert into public.sync_changes (user_id, entity_type, entity_id, op, updated_at)
        values (p_user_id, p_entity_type, p_entity_id, p_op, now())
        on conflict (user_id, entity_type, entity_id)
        do update set
          seq = nextval(pg_get_serial_sequence('public.sync_changes', 'seq')),
          op = excluded.op,
          updated_at = now();
      end;
      $$;
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_profiles()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        perform public.record_sync_change(new.id, 'profile', 'self', 'upsert');
        return new;
      end;
      $$;

      create trigger sync_profiles_after_change
        after insert or update on public.profiles
        for each row execute function public.trg_sync_profiles();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_user_targets()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if tg_op = 'DELETE' then
          perform public.record_sync_change(old.user_id, 'user_targets', 'self', 'delete');
          return old;
        end if;
        perform public.record_sync_change(new.user_id, 'user_targets', 'self', 'upsert');
        return new;
      end;
      $$;

      create trigger sync_user_targets_after_change
        after insert or update or delete on public.user_targets
        for each row execute function public.trg_sync_user_targets();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_foods()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if tg_op = 'DELETE' then
          if old.user_id is not null then
            perform public.record_sync_change(old.user_id, 'food', old.id::text, 'delete');
          end if;
          return old;
        end if;
        if new.user_id is not null then
          perform public.record_sync_change(new.user_id, 'food', new.id::text, 'upsert');
        end if;
        return new;
      end;
      $$;

      create trigger sync_foods_after_change
        after insert or update or delete on public.foods
        for each row execute function public.trg_sync_foods();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_workouts()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if tg_op = 'DELETE' then
          perform public.record_sync_change(old.user_id, 'workout', old.id::text, 'delete');
          return old;
        end if;
        perform public.record_sync_change(new.user_id, 'workout', new.id::text, 'upsert');
        return new;
      end;
      $$;

      create trigger sync_workouts_after_change
        after insert or update or delete on public.workouts
        for each row execute function public.trg_sync_workouts();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_workout_children()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      declare
        v_workout_id uuid;
        v_user_id uuid;
      begin
        if tg_op = 'DELETE' then
          v_workout_id := old.workout_id;
          v_user_id := old.user_id;
        else
          v_workout_id := new.workout_id;
          v_user_id := new.user_id;
        end if;

        if exists (select 1 from public.workouts where id = v_workout_id) then
          perform public.record_sync_change(v_user_id, 'workout', v_workout_id::text, 'upsert');
        end if;

        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $$;

      create trigger sync_workout_sets_after_change
        after insert or update or delete on public.workout_sets
        for each row execute function public.trg_sync_workout_children();

      create trigger sync_cardio_sessions_after_change
        after insert or update or delete on public.cardio_sessions
        for each row execute function public.trg_sync_workout_children();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_meals()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if tg_op = 'DELETE' then
          perform public.record_sync_change(old.user_id, 'meal', old.id::text, 'delete');
          return old;
        end if;
        perform public.record_sync_change(new.user_id, 'meal', new.id::text, 'upsert');
        return new;
      end;
      $$;

      create trigger sync_meals_after_change
        after insert or update or delete on public.meals
        for each row execute function public.trg_sync_meals();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_meal_items()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      declare
        v_meal_id uuid;
        v_user_id uuid;
      begin
        if tg_op = 'DELETE' then
          v_meal_id := old.meal_id;
        else
          v_meal_id := new.meal_id;
        end if;

        select user_id into v_user_id from public.meals where id = v_meal_id;
        if v_user_id is not null then
          perform public.record_sync_change(v_user_id, 'meal', v_meal_id::text, 'upsert');
        end if;

        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $$;

      create trigger sync_meal_items_after_change
        after insert or update or delete on public.meal_items
        for each row execute function public.trg_sync_meal_items();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_meal_templates()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if tg_op = 'DELETE' then
          perform public.record_sync_change(old.user_id, 'meal_template', old.id::text, 'delete');
          return old;
        end if;
        perform public.record_sync_change(new.user_id, 'meal_template', new.id::text, 'upsert');
        return new;
      end;
      $$;

      create trigger sync_meal_templates_after_change
        after insert or update or delete on public.meal_templates
        for each row execute function public.trg_sync_meal_templates();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_daily_steps()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if tg_op = 'DELETE' then
          perform public.record_sync_change(old.user_id, 'daily_steps', old.date::text, 'delete');
          return old;
        end if;
        perform public.record_sync_change(new.user_id, 'daily_steps', new.date::text, 'upsert');
        return new;
      end;
      $$;

      create trigger sync_daily_steps_after_change
        after insert or update or delete on public.daily_steps
        for each row execute function public.trg_sync_daily_steps();
    `);

    await queryRunner.query(`
      create or replace function public.trg_sync_daily_weight()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if tg_op = 'DELETE' then
          perform public.record_sync_change(old.user_id, 'daily_weight', old.date::text, 'delete');
          return old;
        end if;
        perform public.record_sync_change(new.user_id, 'daily_weight', new.date::text, 'upsert');
        return new;
      end;
      $$;

      create trigger sync_daily_weight_after_change
        after insert or update or delete on public.daily_weight
        for each row execute function public.trg_sync_daily_weight();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop trigger if exists sync_daily_weight_after_change on public.daily_weight;`);
    await queryRunner.query(`drop function if exists public.trg_sync_daily_weight();`);
    await queryRunner.query(`drop trigger if exists sync_daily_steps_after_change on public.daily_steps;`);
    await queryRunner.query(`drop function if exists public.trg_sync_daily_steps();`);
    await queryRunner.query(`drop trigger if exists sync_meal_templates_after_change on public.meal_templates;`);
    await queryRunner.query(`drop function if exists public.trg_sync_meal_templates();`);
    await queryRunner.query(`drop trigger if exists sync_meal_items_after_change on public.meal_items;`);
    await queryRunner.query(`drop function if exists public.trg_sync_meal_items();`);
    await queryRunner.query(`drop trigger if exists sync_meals_after_change on public.meals;`);
    await queryRunner.query(`drop function if exists public.trg_sync_meals();`);
    await queryRunner.query(`drop trigger if exists sync_cardio_sessions_after_change on public.cardio_sessions;`);
    await queryRunner.query(`drop trigger if exists sync_workout_sets_after_change on public.workout_sets;`);
    await queryRunner.query(`drop function if exists public.trg_sync_workout_children();`);
    await queryRunner.query(`drop trigger if exists sync_workouts_after_change on public.workouts;`);
    await queryRunner.query(`drop function if exists public.trg_sync_workouts();`);
    await queryRunner.query(`drop trigger if exists sync_foods_after_change on public.foods;`);
    await queryRunner.query(`drop function if exists public.trg_sync_foods();`);
    await queryRunner.query(`drop trigger if exists sync_user_targets_after_change on public.user_targets;`);
    await queryRunner.query(`drop function if exists public.trg_sync_user_targets();`);
    await queryRunner.query(`drop trigger if exists sync_profiles_after_change on public.profiles;`);
    await queryRunner.query(`drop function if exists public.trg_sync_profiles();`);
    await queryRunner.query(`drop function if exists public.record_sync_change(uuid, text, text, text);`);
    await queryRunner.query(`drop table if exists public.sync_changes cascade;`);
  }
}
