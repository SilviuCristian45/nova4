import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGymManagement1766000000000 implements MigrationInterface {
  name = "AddGymManagement1766000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table public.gyms (
        id uuid primary key default gen_random_uuid(),
        slug text not null unique,
        name text not null,
        address text,
        timezone text not null default 'Europe/Bucharest',
        qr_token text not null unique,
        qr_rotated_at timestamptz not null default now(),
        checkin_cooldown_minutes integer not null default 15 check (checkin_cooldown_minutes between 0 and 1440),
        latitude numeric(9, 6),
        longitude numeric(9, 6),
        checkin_radius_meters integer check (checkin_radius_meters is null or checkin_radius_meters between 10 and 50000),
        capacity integer check (capacity is null or capacity between 1 and 100000),
        currency text not null default 'RON',
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    await queryRunner.query(`
      create table public.gym_staff (
        gym_id uuid not null references public.gyms(id) on delete cascade,
        user_id uuid not null references public.users(id) on delete cascade,
        role text not null check (role in ('owner', 'manager', 'reception')),
        created_at timestamptz not null default now(),
        primary key (gym_id, user_id)
      );
      create index gym_staff_user_idx on public.gym_staff (user_id);
    `);

    await queryRunner.query(`
      create table public.gym_membership_plans (
        id uuid primary key default gen_random_uuid(),
        gym_id uuid not null references public.gyms(id) on delete cascade,
        name text not null,
        description text,
        plan_type text not null check (plan_type in ('time_based', 'session_pack')),
        duration_days integer not null check (duration_days between 1 and 3650),
        session_count integer check (session_count is null or session_count between 1 and 1000),
        price_cents integer not null check (price_cents >= 0),
        currency text not null default 'RON',
        allowed_from_time time,
        allowed_to_time time,
        allowed_days_mask smallint not null default 127 check (allowed_days_mask between 1 and 127),
        max_freeze_days integer not null default 0 check (max_freeze_days between 0 and 365),
        is_active boolean not null default true,
        position integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index gym_membership_plans_gym_idx on public.gym_membership_plans (gym_id, position asc);
    `);

    await queryRunner.query(`
      create table public.gym_members (
        id uuid primary key default gen_random_uuid(),
        gym_id uuid not null references public.gyms(id) on delete cascade,
        user_id uuid not null references public.users(id) on delete cascade,
        member_code text not null,
        phone text,
        emergency_contact text,
        notes text,
        status text not null default 'active' check (status in ('active', 'suspended')),
        joined_at timestamptz not null default now(),
        unique (gym_id, user_id),
        unique (gym_id, member_code)
      );
      create index gym_members_user_idx on public.gym_members (user_id);
    `);

    await queryRunner.query(`
      create table public.gym_subscriptions (
        id uuid primary key default gen_random_uuid(),
        gym_id uuid not null references public.gyms(id) on delete cascade,
        member_id uuid not null references public.gym_members(id) on delete cascade,
        user_id uuid not null references public.users(id) on delete cascade,
        plan_id uuid references public.gym_membership_plans(id) on delete set null,
        plan_name_snapshot text not null,
        plan_type text not null check (plan_type in ('time_based', 'session_pack')),
        status text not null check (status in ('pending', 'active', 'frozen', 'expired', 'exhausted', 'cancelled')),
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        sessions_total integer check (sessions_total is null or sessions_total >= 0),
        sessions_remaining integer check (sessions_remaining is null or sessions_remaining >= 0),
        allowed_from_time time,
        allowed_to_time time,
        allowed_days_mask smallint not null default 127 check (allowed_days_mask between 1 and 127),
        max_freeze_days integer not null default 0 check (max_freeze_days between 0 and 365),
        frozen_at timestamptz,
        frozen_until timestamptz,
        total_frozen_days integer not null default 0 check (total_frozen_days >= 0),
        created_by_user_id uuid references public.users(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index gym_subscriptions_gym_user_idx on public.gym_subscriptions (gym_id, user_id, ends_at desc);
      create index gym_subscriptions_status_ends_idx on public.gym_subscriptions (status, ends_at);
    `);

    await queryRunner.query(`
      create table public.gym_payments (
        id uuid primary key default gen_random_uuid(),
        gym_id uuid not null references public.gyms(id) on delete cascade,
        subscription_id uuid references public.gym_subscriptions(id) on delete set null,
        user_id uuid references public.users(id) on delete set null,
        amount_cents integer not null check (amount_cents >= 0),
        currency text not null default 'RON',
        method text not null check (method in ('cash', 'card_pos', 'bank_transfer', 'online')),
        reference text,
        note text,
        recorded_by_user_id uuid references public.users(id) on delete set null,
        paid_at timestamptz not null default now()
      );
      create index gym_payments_gym_paid_idx on public.gym_payments (gym_id, paid_at desc);
    `);

    await queryRunner.query(`
      create table public.gym_checkins (
        id uuid primary key default gen_random_uuid(),
        gym_id uuid not null references public.gyms(id) on delete cascade,
        user_id uuid not null references public.users(id) on delete cascade,
        subscription_id uuid references public.gym_subscriptions(id) on delete set null,
        checked_in_at timestamptz not null default now(),
        checked_out_at timestamptz,
        method text not null check (method in ('qr_printed', 'qr_kiosk', 'qr_member', 'manual_override')),
        outcome text not null check (outcome in (
          'allowed',
          'denied_invalid_qr',
          'denied_not_member',
          'denied_suspended',
          'denied_duplicate',
          'denied_no_subscription',
          'denied_expired',
          'denied_no_sessions',
          'denied_frozen',
          'denied_outside_hours'
        )),
        sessions_after integer,
        override_reason text,
        verified_by_user_id uuid references public.users(id) on delete set null,
        metadata jsonb not null default '{}'::jsonb
      );
      create index gym_checkins_gym_time_idx on public.gym_checkins (gym_id, checked_in_at desc);
      create index gym_checkins_gym_user_time_idx on public.gym_checkins (gym_id, user_id, checked_in_at desc);
    `);

    await queryRunner.query(`
      create table public.gym_audit_logs (
        id uuid primary key default gen_random_uuid(),
        gym_id uuid not null references public.gyms(id) on delete cascade,
        actor_user_id uuid references public.users(id) on delete set null,
        action text not null,
        target_type text,
        target_id uuid,
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create index gym_audit_logs_gym_time_idx on public.gym_audit_logs (gym_id, created_at desc);
    `);

    // Allow gym notification types in public.notifications
    await queryRunner.query(`
      alter table public.notifications drop constraint if exists notifications_type_check;
      alter table public.notifications
        add constraint notifications_type_check check (type in (
          'enroll_requested', 'enroll_approved', 'enroll_rejected',
          'program_assigned', 'workout_feedback',
          'weekly_checkin_submitted', 'weekly_checkin_reviewed', 'client_pr',
          'meal_plan_assigned', 'meal_plan_updated',
          'gym_subscription_expiring', 'gym_subscription_low_sessions'
        ));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table public.notifications drop constraint if exists notifications_type_check;
      alter table public.notifications
        add constraint notifications_type_check check (type in (
          'enroll_requested', 'enroll_approved', 'enroll_rejected',
          'program_assigned', 'workout_feedback',
          'weekly_checkin_submitted', 'weekly_checkin_reviewed', 'client_pr',
          'meal_plan_assigned', 'meal_plan_updated'
        ));
    `);
    await queryRunner.query(`drop table if exists public.gym_audit_logs cascade;`);
    await queryRunner.query(`drop table if exists public.gym_checkins cascade;`);
    await queryRunner.query(`drop table if exists public.gym_payments cascade;`);
    await queryRunner.query(`drop table if exists public.gym_subscriptions cascade;`);
    await queryRunner.query(`drop table if exists public.gym_members cascade;`);
    await queryRunner.query(`drop table if exists public.gym_membership_plans cascade;`);
    await queryRunner.query(`drop table if exists public.gym_staff cascade;`);
    await queryRunner.query(`drop table if exists public.gyms cascade;`);
  }
}
