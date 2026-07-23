import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// No extra filters yet beyond page/limit — Programs are already scoped to
// the current user at the query level (see ProgramsService.findAll), so
// there's no cross-user filtering concern the way Exercises had
// category/muscleGroup. Extend this if search-by-name is wanted later.
export class ListProgramsQueryDto extends PaginationQueryDto {}
