// Deliberately excludes the nested exercises array — a list endpoint
// returning full exercise details (each with its own Exercise catalog
// lookup) for every Program on the page would mean N+1-shaped joins for
// no benefit, since a list view typically just needs enough to let the
// user pick which Program to open. Full detail (including exercises)
// lives in ProgramDetailResponseDto, returned only from GET /programs/:id
// and the create/update endpoints.
export class ProgramSummaryResponseDto {
  id!: string;
  name!: string;
  description!: string | null;
  exerciseCount!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
