import { Injectable, type MessageEvent } from "@nestjs/common";
import { Observable, Subject, interval, map, merge } from "rxjs";
import type { GymCheckinMethod, GymCheckinOutcome, GymPlanType } from "@replog/shared";

export interface GymCheckinLiveEvent {
  checkinId: string;
  gymId: string;
  checkedInAt: string;
  method: GymCheckinMethod;
  outcome: GymCheckinOutcome;
  memberId: string | null;
  userId: string;
  memberName: string;
  memberEmail: string;
  memberCode: string | null;
  planName: string | null;
  planType: GymPlanType | null;
  daysLeft: number | null;
  endsAt: string | null;
  sessionsAfter: number | null;
  sessionsTotal: number | null;
  expiringSoon: boolean;
  overrideReason: string | null;
  frozenUntil: string | null;
  allowedFromTime: string | null;
  allowedToTime: string | null;
  gpsRejected: boolean;
}

@Injectable()
export class GymSseService {
  private readonly channels = new Map<string, Subject<GymCheckinLiveEvent>>();

  private getOrCreateChannel(gymId: string): Subject<GymCheckinLiveEvent> {
    let channel = this.channels.get(gymId);
    if (!channel) {
      channel = new Subject<GymCheckinLiveEvent>();
      this.channels.set(gymId, channel);
    }
    return channel;
  }

  emit(gymId: string, event: GymCheckinLiveEvent): void {
    const channel = this.channels.get(gymId);
    if (!channel) return;
    channel.next(event);
  }

  subscribe(gymId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const channel = this.getOrCreateChannel(gymId);

      // Immediate connected event so the UI flips its Live indicator on right away.
      subscriber.next({
        type: "connected",
        data: { gymId, ts: new Date().toISOString() },
      });

      const events$ = channel.asObservable().pipe(
        map(
          (payload): MessageEvent => ({
            type: "checkin",
            data: payload,
          }),
        ),
      );

      const heartbeat$ = interval(25_000).pipe(
        map(
          (): MessageEvent => ({
            type: "ping",
            data: { ts: new Date().toISOString() },
          }),
        ),
      );

      const sub = merge(events$, heartbeat$).subscribe(subscriber);

      return () => {
        sub.unsubscribe();
        if (!channel.observed) {
          this.channels.delete(gymId);
        }
      };
    });
  }
}
