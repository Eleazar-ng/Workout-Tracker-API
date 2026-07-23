import { PartialType } from '@nestjs/mapped-types';
import { CreateProgramDto } from './create-program.dto';

// PartialType makes every field optional while PRESERVING each field's
// validation rules when it IS provided — e.g. `exercises`, if included in
// a PATCH body, still must have at least one entry (ArrayMinSize(1) still
// applies), it's just no longer REQUIRED to be present at all.
//
// Semantics: omitting `exercises` entirely leaves the Program's existing
// exercises untouched. Providing `exercises` (even as related to just one
// changed entry) FULLY REPLACES the existing list — per our Stage 5
// decision, there is no partial-merge/diff behavior. A client that wants
// to change one exercise's target reps must resend the complete exercises
// array, not just the one changed entry.
export class UpdateProgramDto extends PartialType(CreateProgramDto) {}
