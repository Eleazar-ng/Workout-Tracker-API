// Deliberately minimal — no email, no dates, nothing beyond what's needed
// to render "who did this" in a list or feed entry. Per our Stage 9
// decision, there's no separate profile endpoint, so this is the ONLY
// shape of another user's data ever exposed anywhere in the Social module.
export class UserSummaryDto {
  id!: string;
  firstName!: string;
  lastName!: string;
}
