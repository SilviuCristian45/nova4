import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1764000000000 implements MigrationInterface {
  name = "InitialSchema1764000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`create extension if not exists pgcrypto;`);

    // =========================================================================
    // 1. Identity & Sessions (replaces Supabase auth.users)
    // =========================================================================
    await queryRunner.query(`
      create table public.users (
        id uuid primary key default gen_random_uuid(),
        email text not null check (char_length(trim(email)) between 3 and 320),
        password_hash text not null,
        email_verified_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create unique index users_email_lower_uidx on public.users (lower(email));
    `);

    await queryRunner.query(`
      create table public.refresh_tokens (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references public.users(id) on delete cascade,
        token_hash text not null unique,
        family_id uuid not null,
        replaced_by_id uuid references public.refresh_tokens(id) on delete set null,
        user_agent text,
        ip_address text,
        expires_at timestamptz not null,
        revoked_at timestamptz,
        created_at timestamptz not null default now()
      );
      create index refresh_tokens_user_id_idx on public.refresh_tokens (user_id);
      create index refresh_tokens_family_id_idx on public.refresh_tokens (family_id);
      create index refresh_tokens_expires_at_idx on public.refresh_tokens (expires_at);
    `);

    // =========================================================================
    // 2. Profiles & Coach Profiles
    // =========================================================================
    await queryRunner.query(`
      create table public.profiles (
        id uuid primary key references public.users(id) on delete cascade,
        daily_steps_goal integer not null default 10000 constraint goal_positive check (daily_steps_goal > 0),
        display_name text check (display_name is null or char_length(display_name) between 1 and 80),
        height_cm numeric(4, 1) check (height_cm is null or height_cm between 50 and 272),
        birth_date date check (birth_date is null or birth_date >= date '1900-01-01'),
        sex text check (sex is null or sex in ('male', 'female')),
        weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
        activity_level text check (activity_level is null or activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')),
        goal_kg_per_week numeric(3, 2) not null default 0 check (goal_kg_per_week between -1 and 1),
        role text not null default 'client' check (role in ('client', 'coach'))
      );
    `);

    await queryRunner.query(`
      create table public.coach_profiles (
        user_id uuid primary key references public.users(id) on delete cascade,
        display_name text not null check (char_length(trim(display_name)) between 1 and 80),
        bio text check (bio is null or char_length(bio) <= 1000),
        specialties text[] not null default '{}' check (cardinality(specialties) <= 10),
        is_public boolean not null default false,
        accepting_clients boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    // =========================================================================
    // 3. Programs, Enrollments & Coach Client Notes
    // =========================================================================
    await queryRunner.query(`
      create table public.programs (
        id uuid primary key default gen_random_uuid(),
        coach_id uuid not null references public.users(id) on delete cascade,
        assigned_client_id uuid references public.users(id) on delete cascade,
        title text not null check (char_length(trim(title)) between 1 and 120),
        description text check (description is null or char_length(description) <= 2000),
        difficulty text not null default 'intermediate'
          check (difficulty in ('beginner', 'intermediate', 'advanced')),
        duration_weeks integer not null default 4 check (duration_weeks between 1 and 52),
        goal text not null default 'hypertrophy'
          check (goal in ('hypertrophy', 'strength', 'fat_loss', 'endurance', 'general_fitness')),
        status text not null default 'draft'
          check (status in ('draft', 'published', 'archived')),
        access_type text not null default 'public'
          check (access_type in ('public', 'invite_only')),
        requires_approval boolean not null default false,
        invite_code text unique check (invite_code is null or invite_code ~ '^[A-Z0-9]{6,16}$'),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (assigned_client_id is null or assigned_client_id <> coach_id),
        check (assigned_client_id is null or access_type = 'invite_only')
      );
      create index programs_coach_id_idx on public.programs (coach_id, status);
      create index programs_public_idx on public.programs (status, access_type)
        where status = 'published' and access_type = 'public' and assigned_client_id is null;
    `);

    await queryRunner.query(`
      create table public.program_workouts (
        id uuid primary key default gen_random_uuid(),
        program_id uuid not null references public.programs(id) on delete cascade,
        week_number integer not null default 1 check (week_number between 1 and 52),
        day_number integer not null check (day_number between 1 and 7),
        position integer not null default 1 check (position >= 1),
        title text not null check (char_length(trim(title)) between 1 and 120),
        workout_mode text not null default 'strength' check (workout_mode in ('strength', 'cardio')),
        split text not null check (char_length(trim(split)) between 1 and 100),
        notes text check (notes is null or char_length(notes) <= 1000),
        created_at timestamptz not null default now()
      );
      create index program_workouts_program_idx
        on public.program_workouts (program_id, week_number, day_number, position);
    `);

    await queryRunner.query(`
      create table public.program_workout_exercises (
        id uuid primary key default gen_random_uuid(),
        program_workout_id uuid not null references public.program_workouts(id) on delete cascade,
        position integer not null check (position >= 1),
        exercise text not null check (char_length(trim(exercise)) between 1 and 300),
        set_type text not null default 'Working Set' check (char_length(trim(set_type)) between 1 and 100),
        target_sets integer not null check (target_sets between 1 and 50),
        target_reps_min integer not null check (target_reps_min between 1 and 1000),
        target_reps_max integer not null check (target_reps_max >= target_reps_min and target_reps_max <= 1000),
        target_rir smallint check (target_rir is null or target_rir between 0 and 5),
        target_weight_kg numeric(7, 2) check (target_weight_kg is null or target_weight_kg between 0 and 10000),
        rest_seconds integer check (rest_seconds is null or rest_seconds between 10 and 900),
        notes text check (notes is null or char_length(notes) <= 280)
      );
      create index program_workout_exercises_idx
        on public.program_workout_exercises (program_workout_id, position);
    `);

    await queryRunner.query(`
      create table public.program_workout_cardio (
        id uuid primary key default gen_random_uuid(),
        program_workout_id uuid not null references public.program_workouts(id) on delete cascade,
        position integer not null check (position >= 1),
        activity text not null check (char_length(trim(activity)) between 1 and 120),
        target_duration_min integer not null check (target_duration_min between 1 and 1440),
        notes text check (notes is null or char_length(notes) <= 280)
      );
      create index program_workout_cardio_idx
        on public.program_workout_cardio (program_workout_id, position);
    `);

    await queryRunner.query(`
      create table public.enrollments (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references public.users(id) on delete cascade,
        coach_id uuid not null references public.users(id) on delete cascade,
        program_id uuid references public.programs(id) on delete set null,
        status text not null default 'pending'
          check (status in ('pending', 'active', 'paused', 'completed', 'rejected')),
        share_nutrition boolean not null default true,
        current_week integer not null default 1 check (current_week between 1 and 52),
        assigned_by_coach boolean not null default false,
        started_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (client_id <> coach_id)
      );
      create index enrollments_coach_client_status_idx
        on public.enrollments (coach_id, client_id, status);
      create index enrollments_client_status_idx
        on public.enrollments (client_id, status);
      create unique index enrollments_open_unique_idx
        on public.enrollments (client_id, program_id)
        where program_id is not null and status in ('pending', 'active', 'paused');
    `);

    await queryRunner.query(`
      create table public.coach_client_notes (
        coach_id uuid not null references public.users(id) on delete cascade,
        client_id uuid not null references public.users(id) on delete cascade,
        note text not null default '' check (char_length(note) <= 4000),
        updated_at timestamptz not null default now(),
        primary key (coach_id, client_id),
        check (coach_id <> client_id)
      );
    `);

    // =========================================================================
    // 4. Workouts, Sets, Cardio, Drafts & Feedback
    // =========================================================================
    await queryRunner.query(`
      create table public.workouts (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references public.users(id) on delete cascade,
        performed_on date not null default current_date,
        split text not null,
        created_at timestamptz not null default now(),
        client_id text,
        workout_mode text not null default 'strength' check (workout_mode in ('strength', 'cardio')),
        program_workout_id uuid references public.program_workouts(id) on delete set null,
        enrollment_id uuid references public.enrollments(id) on delete set null
      );
      create index workouts_user_id_idx on public.workouts (user_id, performed_on desc, created_at desc);
      create unique index workouts_user_client_id_uidx on public.workouts (user_id, client_id) where client_id is not null;
      create index workouts_enrollment_idx on public.workouts (enrollment_id, performed_on desc) where enrollment_id is not null;
    `);

    await queryRunner.query(`
      create table public.workout_sets (
        id uuid primary key default gen_random_uuid(),
        workout_id uuid not null references public.workouts(id) on delete cascade,
        user_id uuid not null references public.users(id) on delete cascade,
        split text not null,
        exercise text not null,
        set_number integer not null check (set_number >= 1),
        reps integer not null check (reps >= 0),
        rir integer check (rir is null or rir between 0 and 5),
        set_type text not null,
        created_at timestamptz not null default now(),
        weight numeric(7, 2) not null default 0 check (weight between 0 and 10000),
        notes varchar check (notes is null or length(notes::text) < 100),
        is_pr boolean not null default false
      );
      create index workout_sets_workout_id_idx on public.workout_sets (workout_id);
      create index workout_sets_pr_idx on public.workout_sets (user_id, created_at desc) where is_pr = true;
    `);

    await queryRunner.query(`
      create table public.cardio_sessions (
        id uuid primary key default gen_random_uuid(),
        workout_id uuid not null references public.workouts(id) on delete cascade,
        user_id uuid not null references public.users(id) on delete cascade,
        activity text not null check (char_length(activity) between 1 and 120),
        duration_min integer not null check (duration_min > 0 and duration_min <= 1440),
        created_at timestamptz not null default now()
      );
      create index cardio_sessions_user_id_idx on public.cardio_sessions (user_id);
      create index cardio_sessions_workout_id_idx on public.cardio_sessions (workout_id);
    `);

    await queryRunner.query(`
      create table public.workout_drafts (
        user_id uuid primary key references public.users(id) on delete cascade,
        draft jsonb not null check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 1000000),
        client_updated_at timestamptz not null,
        updated_at timestamptz not null default now()
      );
    `);

    await queryRunner.query(`
      create table public.workout_feedback (
        id uuid primary key default gen_random_uuid(),
        workout_id uuid not null references public.workouts(id) on delete cascade,
        author_id uuid not null references public.users(id) on delete cascade,
        body text not null check (char_length(trim(body)) between 1 and 1000),
        reaction text check (reaction is null or reaction in ('fire', 'trophy', 'muscle', 'check', 'clap')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index workout_feedback_workout_idx on public.workout_feedback (workout_id, created_at asc);
    `);

    // =========================================================================
    // 5. Nutrition, Foods, Meals, Templates, Targets & Coach Meal Plans
    // =========================================================================
    await queryRunner.query(`
      create table public.foods (
        id uuid primary key default gen_random_uuid(),
        user_id uuid references public.users(id) on delete cascade,
        name text not null,
        brand text,
        barcode text unique,
        kcal_per_100g numeric not null default 0,
        protein_per_100g numeric not null default 0,
        carbs_per_100g numeric not null default 0,
        fat_per_100g numeric not null default 0,
        saturated_fat_per_100g numeric default 0,
        polyunsaturated_fat_per_100g numeric default 0,
        fiber_per_100g numeric default 0,
        sodium_mg_per_100g numeric default 0,
        created_at timestamptz not null default timezone('utc', now())
      );
    `);

    await queryRunner.query(`
      create table public.meals (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references public.users(id) on delete cascade,
        performed_on date not null default current_date,
        meal_type text not null check (meal_type in ('Breakfast', 'Lunch', 'Dinner', 'Snack')),
        notes text,
        created_at timestamptz not null default timezone('utc', now())
      );
      create index meals_user_performed_on_idx on public.meals (user_id, performed_on desc);
    `);

    await queryRunner.query(`
      create table public.meal_items (
        id uuid primary key default gen_random_uuid(),
        meal_id uuid not null references public.meals(id) on delete cascade,
        food_id uuid not null references public.foods(id) on delete cascade,
        consumed_weight_g numeric not null,
        total_kcal numeric not null default 0,
        total_protein_g numeric not null default 0,
        total_carbs_g numeric not null default 0,
        total_fat_g numeric not null default 0,
        created_at timestamptz not null default timezone('utc', now())
      );
      create index meal_items_meal_id_idx on public.meal_items (meal_id);
    `);

    await queryRunner.query(`
      create table public.meal_templates (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references public.users(id) on delete cascade,
        name text not null,
        items jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default timezone('utc', now())
      );
    `);

    await queryRunner.query(`
      create table public.user_targets (
        user_id uuid primary key references public.users(id) on delete cascade,
        kcal integer not null default 2200,
        protein integer not null default 160,
        carbs integer not null default 250,
        fat integer not null default 70,
        fiber integer not null default 30,
        updated_at timestamptz default timezone('utc', now())
      );
    `);

    await queryRunner.query(`
      create table public.meal_plans (
        id uuid primary key default gen_random_uuid(),
        coach_id uuid not null references public.users(id) on delete cascade,
        assigned_client_id uuid references public.users(id) on delete cascade,
        title text not null check (char_length(trim(title)) between 1 and 120),
        description text check (description is null or char_length(description) <= 2000),
        goal text not null default 'maintenance'
          check (goal in ('fat_loss', 'maintenance', 'muscle_gain', 'recomp', 'performance')),
        status text not null default 'draft'
          check (status in ('draft', 'active', 'archived')),
        target_kcal integer check (target_kcal is null or target_kcal between 500 and 15000),
        target_protein_g integer check (target_protein_g is null or target_protein_g between 0 and 1000),
        target_carbs_g integer check (target_carbs_g is null or target_carbs_g between 0 and 2000),
        target_fat_g integer check (target_fat_g is null or target_fat_g between 0 and 500),
        target_fiber_g integer check (target_fiber_g is null or target_fiber_g between 0 and 200),
        water_liters numeric(3, 1) check (water_liters is null or water_liters between 0.5 and 15.0),
        notes text check (notes is null or char_length(notes) <= 3000),
        share_token text unique check (share_token is null or share_token ~ '^[A-Za-z0-9_-]{16,64}$'),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (assigned_client_id is null or assigned_client_id <> coach_id)
      );
      create index meal_plans_coach_idx on public.meal_plans (coach_id, status, updated_at desc);
      create index meal_plans_client_active_idx on public.meal_plans (assigned_client_id, status, updated_at desc)
        where assigned_client_id is not null;
    `);

    await queryRunner.query(`
      create table public.meal_plan_days (
        id uuid primary key default gen_random_uuid(),
        meal_plan_id uuid not null references public.meal_plans(id) on delete cascade,
        position integer not null check (position >= 1),
        title text not null check (char_length(trim(title)) between 1 and 80),
        notes text check (notes is null or char_length(notes) <= 1000)
      );
      create index meal_plan_days_plan_idx on public.meal_plan_days (meal_plan_id, position);
    `);

    await queryRunner.query(`
      create table public.meal_plan_meals (
        id uuid primary key default gen_random_uuid(),
        meal_plan_day_id uuid not null references public.meal_plan_days(id) on delete cascade,
        position integer not null check (position >= 1),
        meal_type text not null default 'Breakfast'
          check (meal_type in ('Breakfast', 'Lunch', 'Dinner', 'Snack', 'Meal')),
        title text not null check (char_length(trim(title)) between 1 and 120),
        time_label text check (time_label is null or char_length(trim(time_label)) <= 30),
        notes text check (notes is null or char_length(notes) <= 1000)
      );
      create index meal_plan_meals_day_idx on public.meal_plan_meals (meal_plan_day_id, position);
    `);

    await queryRunner.query(`
      create table public.meal_plan_items (
        id uuid primary key default gen_random_uuid(),
        meal_plan_meal_id uuid not null references public.meal_plan_meals(id) on delete cascade,
        position integer not null check (position >= 1),
        food_id uuid references public.foods(id) on delete set null,
        name text not null check (char_length(trim(name)) between 1 and 200),
        brand text check (brand is null or char_length(brand) <= 120),
        grams numeric(7, 1) not null check (grams > 0 and grams <= 10000),
        kcal_per_100g numeric(7, 2) not null default 0 check (kcal_per_100g >= 0 and kcal_per_100g <= 10000),
        protein_per_100g numeric(7, 2) not null default 0 check (protein_per_100g >= 0 and protein_per_100g <= 1000),
        carbs_per_100g numeric(7, 2) not null default 0 check (carbs_per_100g >= 0 and carbs_per_100g <= 1000),
        fat_per_100g numeric(7, 2) not null default 0 check (fat_per_100g >= 0 and fat_per_100g <= 1000),
        fiber_per_100g numeric(7, 2) check (fiber_per_100g is null or (fiber_per_100g >= 0 and fiber_per_100g <= 1000)),
        notes text check (notes is null or char_length(notes) <= 280)
      );
      create index meal_plan_items_meal_idx on public.meal_plan_items (meal_plan_meal_id, position);
    `);

    // =========================================================================
    // 6. Daily Metrics, Progress Photos, Weekly Check-ins & Notifications
    // =========================================================================
    await queryRunner.query(`
      create table public.daily_steps (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references public.users(id) on delete cascade,
        date date not null default current_date,
        steps integer not null default 0 check (steps >= 0),
        unique (user_id, date)
      );
    `);

    await queryRunner.query(`
      create table public.daily_weight (
        user_id uuid not null references public.users(id) on delete cascade,
        date date not null,
        weight_kg numeric(6, 2) not null check (weight_kg > 0 and weight_kg < 10000),
        primary key (user_id, date)
      );
    `);

    await queryRunner.query(`
      create table public.daily_checkin (
        user_id uuid not null references public.users(id) on delete cascade,
        date date not null,
        energy smallint check (energy between 1 and 10),
        satiety smallint check (satiety between 1 and 10),
        sleep smallint check (sleep between 1 and 10),
        note text check (char_length(note) <= 280),
        primary key (user_id, date),
        check (energy is not null or satiety is not null or sleep is not null or note is not null)
      );
    `);

    await queryRunner.query(`
      create table public.progress_photos (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references public.users(id) on delete cascade,
        taken_on date not null,
        pose text not null default 'front' check (pose in ('front', 'side', 'back', 'other')),
        note text check (note is null or char_length(note) <= 280),
        path text not null unique,
        size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
        created_at timestamptz not null default now(),
        check (path = user_id::text || '/' || id::text || '.jpg')
      );
      create index progress_photos_user_date_idx on public.progress_photos (user_id, taken_on desc);

      create or replace function public.progress_photos_limit()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if (select count(*) from public.progress_photos where user_id = new.user_id) >= 200 then
          raise exception 'Photo limit reached' using errcode = 'check_violation';
        end if;
        return new;
      end;
      $$;

      create trigger progress_photos_limit
        before insert on public.progress_photos
        for each row execute function public.progress_photos_limit();
    `);

    await queryRunner.query(`
      create table public.weekly_checkins (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references public.users(id) on delete cascade,
        coach_id uuid not null references public.users(id) on delete cascade,
        enrollment_id uuid references public.enrollments(id) on delete set null,
        week_start date not null,
        weight_kg numeric(6, 2) check (weight_kg is null or weight_kg between 0.01 and 9999.99),
        energy smallint not null check (energy between 1 and 5),
        sleep smallint not null check (sleep between 1 and 5),
        stress smallint not null check (stress between 1 and 5),
        client_notes text check (client_notes is null or char_length(client_notes) <= 1500),
        coach_reply text check (coach_reply is null or char_length(coach_reply) <= 1500),
        photo_front_path text check (
          photo_front_path is null
          or photo_front_path ~ ('^' || client_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$')
        ),
        photo_back_path text check (
          photo_back_path is null
          or photo_back_path ~ ('^' || client_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$')
        ),
        photo_side_path text check (
          photo_side_path is null
          or photo_side_path ~ ('^' || client_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$')
        ),
        reviewed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (client_id, coach_id, week_start),
        check (client_id <> coach_id)
      );
      create index weekly_checkins_coach_idx on public.weekly_checkins (coach_id, week_start desc);
      create index weekly_checkins_client_idx on public.weekly_checkins (client_id, week_start desc);
      create index weekly_checkins_photo_front_idx on public.weekly_checkins (photo_front_path) where photo_front_path is not null;
      create index weekly_checkins_photo_back_idx on public.weekly_checkins (photo_back_path) where photo_back_path is not null;
      create index weekly_checkins_photo_side_idx on public.weekly_checkins (photo_side_path) where photo_side_path is not null;
    `);

    await queryRunner.query(`
      create table public.notifications (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references public.users(id) on delete cascade,
        actor_id uuid references public.users(id) on delete set null,
        type text not null check (type in (
          'enroll_requested', 'enroll_approved', 'enroll_rejected',
          'program_assigned', 'workout_feedback',
          'weekly_checkin_submitted', 'weekly_checkin_reviewed', 'client_pr',
          'meal_plan_assigned', 'meal_plan_updated'
        )),
        payload jsonb not null default '{}'::jsonb,
        link text check (link is null or link like '/%'),
        read_at timestamptz,
        created_at timestamptz not null default now()
      );
      create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
      create index notifications_user_recent_idx on public.notifications (user_id, created_at desc);
    `);

    // =========================================================================
    // 7. Offline Sync Receipts & Google Drive Backups
    // =========================================================================
    await queryRunner.query(`
      create table public.offline_sync_receipts (
        user_id uuid not null references public.users(id) on delete cascade,
        mutation_id uuid not null,
        payload jsonb not null,
        synced_at timestamptz not null default now(),
        primary key (user_id, mutation_id)
      );
    `);

    await queryRunner.query(`
      create table public.google_drive_backups (
        user_id uuid primary key references public.users(id) on delete cascade,
        email text,
        refresh_token text not null,
        frequency text not null default 'off' check (frequency in ('off', 'daily', 'weekly', 'monthly')),
        last_backup_at timestamptz,
        last_error text check (last_error is null or char_length(last_error) <= 1000),
        created_at timestamptz not null default now()
      );
      create index google_drive_backups_enabled_idx on public.google_drive_backups (frequency) where frequency <> 'off';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table if exists public.google_drive_backups cascade;`);
    await queryRunner.query(`drop table if exists public.offline_sync_receipts cascade;`);
    await queryRunner.query(`drop table if exists public.notifications cascade;`);
    await queryRunner.query(`drop table if exists public.weekly_checkins cascade;`);
    await queryRunner.query(`drop trigger if exists progress_photos_limit on public.progress_photos;`);
    await queryRunner.query(`drop function if exists public.progress_photos_limit();`);
    await queryRunner.query(`drop table if exists public.progress_photos cascade;`);
    await queryRunner.query(`drop table if exists public.daily_checkin cascade;`);
    await queryRunner.query(`drop table if exists public.daily_weight cascade;`);
    await queryRunner.query(`drop table if exists public.daily_steps cascade;`);
    await queryRunner.query(`drop table if exists public.meal_plan_items cascade;`);
    await queryRunner.query(`drop table if exists public.meal_plan_meals cascade;`);
    await queryRunner.query(`drop table if exists public.meal_plan_days cascade;`);
    await queryRunner.query(`drop table if exists public.meal_plans cascade;`);
    await queryRunner.query(`drop table if exists public.user_targets cascade;`);
    await queryRunner.query(`drop table if exists public.meal_templates cascade;`);
    await queryRunner.query(`drop table if exists public.meal_items cascade;`);
    await queryRunner.query(`drop table if exists public.meals cascade;`);
    await queryRunner.query(`drop table if exists public.foods cascade;`);
    await queryRunner.query(`drop table if exists public.workout_feedback cascade;`);
    await queryRunner.query(`drop table if exists public.workout_drafts cascade;`);
    await queryRunner.query(`drop table if exists public.cardio_sessions cascade;`);
    await queryRunner.query(`drop table if exists public.workout_sets cascade;`);
    await queryRunner.query(`drop table if exists public.workouts cascade;`);
    await queryRunner.query(`drop table if exists public.coach_client_notes cascade;`);
    await queryRunner.query(`drop table if exists public.enrollments cascade;`);
    await queryRunner.query(`drop table if exists public.program_workout_cardio cascade;`);
    await queryRunner.query(`drop table if exists public.program_workout_exercises cascade;`);
    await queryRunner.query(`drop table if exists public.program_workouts cascade;`);
    await queryRunner.query(`drop table if exists public.programs cascade;`);
    await queryRunner.query(`drop table if exists public.coach_profiles cascade;`);
    await queryRunner.query(`drop table if exists public.profiles cascade;`);
    await queryRunner.query(`drop table if exists public.refresh_tokens cascade;`);
    await queryRunner.query(`drop table if exists public.users cascade;`);
  }
}
