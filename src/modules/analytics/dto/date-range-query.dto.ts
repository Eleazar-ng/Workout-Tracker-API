import { IsDateString, IsOptional } from 'class-validator';

// Both optional — service applies a default 30-day lookback window when
// neither is provided (see AnalyticsService.getSummary). Using
// workout.scheduledAt as the date dimension throughout this module (not
// set.completedAt) — see AnalyticsService for the reasoning.
export class DateRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
