// Core domain types shared by every rule module.
// Framework-free on purpose: the scoring/pot/pick rules are pure functions over
// these shapes, so they unit test without a database, a mail server, or a network.

/**
 * A league is the long-lived container that spans years (e.g. "Main League").
 * A test league is an ordinary league flagged so its money and standings are
 * never mixed into the real one.
 */
export interface League {
  id: string;
  name: string;
  isTest: boolean;
  createdAt: string; // ISO datetime
}

export type SeasonStatus = "DRAFT" | "ACTIVE" | "COMPLETE";

/**
 * One year of a league. Everything that resets annually — picks, the
 * one-and-done pool, standings, pot balances — is scoped to a season.
 * Completed seasons are retained forever as history.
 */
export interface Season {
  id: string;
  leagueId: string;
  year: number;
  status: SeasonStatus;
  /** Season opens Jan 1; the first tournament after this date is event 1. */
  startDate: string; // ISO date
  /** Ends with the 2nd FedEx Cup playoff event (2nd-to-last event of the season). */
  endDate: string | null; // ISO date, null until the finale is known
  /** Weekly Greller contribution per participant, in dollars. */
  grellerWeeklyContribution: number;
  /** Fine per missed cut that funds Side Pot 1, in dollars. */
  missedCutFine: number;
  /** Base weekly TOCC stake per participant, in dollars. */
  toccStake: number;
  /** TOCC stake when the winning pick also won the real tournament, in dollars. */
  toccStakeIfWinner: number;
}

export interface Participant {
  id: string;
  name: string;
  email: string;
  /**
   * Optional display name shown to other participants in standings, pots,
   * and picks instead of `name` — lets someone go by "Dreifuss" instead of
   * their legal name without affecting login (still by email) or admin views.
   */
  nickname?: string | null;
  /** Unlocks the admin views on the web app. Defaults to false/undefined for everyone else. */
  isAdmin?: boolean;
  /** Null until they've set a password via the emailed set-password link. */
  passwordHash?: string | null;
  /**
   * ISO datetime of the last password set/change. Embedded in signed session
   * cookies so changing your password invalidates every other active session
   * without needing a server-side session table.
   */
  passwordSetAt?: string | null;
}

/**
 * Dedupe record for a scheduled email so a periodic sweep never sends the
 * same nudge/digest twice. PICKS_DIGEST is one record per tournament (a
 * single broadcast email); PICK_REMINDER is one record per participant, since
 * each non-picker is nudged individually.
 */
export type NotificationType = "PICK_REMINDER" | "PICKS_DIGEST";

export interface NotificationRecord {
  type: NotificationType;
  tournamentId: string;
  /** Set only for PICK_REMINDER. */
  participantId?: string;
  sentAt: string; // ISO datetime
}

/** A one-time link for setting or resetting a participant's password, emailed to them. */
export interface PasswordResetToken {
  token: string;
  participantId: string;
  expiresAt: string; // ISO datetime
}

/**
 * Membership of a participant in a specific season. Rosters and TOCC
 * membership can change year to year, so this is per-season rather than a
 * flag on Participant.
 */
export interface SeasonEntry {
  seasonId: string;
  participantId: string;
  isTOCCMember: boolean;
}

export interface Tournament {
  id: string;
  seasonId: string;
  name: string;
  /** 1-based chronological order within the season. */
  sequence: number;
  /**
   * Tee-off time of round 1. This is also the hard pick deadline: a pick email
   * must be RECEIVED strictly before this instant to count.
   */
  startTime: string; // ISO datetime
  /** True for the 2nd FedEx Cup playoff event, which closes the season. */
  isSeasonFinale: boolean;
  /** External id from the golf data provider (DataGolf event id). */
  externalEventId?: string;
}

export interface Golfer {
  id: string;
  name: string;
  /** DataGolf player id, when known. */
  externalId?: string;
}

/** How a pick came to exist. Hearn picks are auto-assigned at the deadline. */
export type PickSource = "web" | "admin" | "hearn";

export interface Pick {
  participantId: string;
  seasonId: string;
  tournamentId: string;
  golferId: string;
  submittedAt: string; // ISO datetime
  source: PickSource;
}

/**
 * A participant's static, ordered fallback list for a season. If they forget
 * to pick before a tournament starts, the engine walks this list in rank
 * order and assigns the first golfer that is both unused this season and in
 * this week's field.
 */
export interface HearnPick {
  seasonId: string;
  participantId: string;
  golferId: string;
  /** 1-based preference order; lower is tried first. */
  rank: number;
}

export interface GolferResult {
  tournamentId: string;
  golferId: string;
  earnings: number;
  finishPosition: number | null; // null = missed cut / WD / no result
  madeCut: boolean;
  isWin: boolean;
  isTop5: boolean;
  isTop10: boolean;
}

/** Defines which tournament sequence ranges make up each quarter of the season. */
export interface QuarterBoundary {
  quarter: 1 | 2 | 3 | 4;
  firstSequence: number;
  lastSequence: number;
}
