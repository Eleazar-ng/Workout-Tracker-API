import { UserSummaryDto } from './user-summary.dto';

// "type" discriminates the union so clients can render each entry kind
// differently. `occurredAt` is the field BOTH kinds are sorted by — for
// a workout it's completedAt, for a comment it's createdAt — normalized
// to one name here so the merge/sort logic (and any client consuming
// this) doesn't need to branch on type just to find "when did this
// happen."
export class WorkoutCompletedFeedEntryDto {
  type = 'WORKOUT_COMPLETED' as const;
  occurredAt!: Date;
  user!: UserSummaryDto;
  workoutId!: string;
  workoutName!: string;
  // Substituted for "duration," which our schema can't compute (no
  // startedAt field on Workout) — see the note where this stage was
  // planned. exerciseCount and totalVolume are both genuinely derivable
  // from data we already have.
  exerciseCount!: number;
  totalSetsPerformed!: number;
  totalVolume!: number;
}

export class CommentFeedEntryDto {
  type = 'COMMENT' as const;
  occurredAt!: Date;
  user!: UserSummaryDto;
  commentId!: string;
  content!: string;
  workoutId!: string;
  workoutName!: string;
}

export type FeedEntryDto = WorkoutCompletedFeedEntryDto | CommentFeedEntryDto;
