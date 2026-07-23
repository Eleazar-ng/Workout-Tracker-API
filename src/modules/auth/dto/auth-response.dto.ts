import { UserResponseDto } from '../../users/dto/user-response.dto';

// The refresh token is NEVER included here — it's set as an httpOnly
// cookie by the controller, never returned in a JSON body where
// client-side JS (and therefore XSS) could read it.
export class AuthResponseDto {
  accessToken!: string;
  user!: UserResponseDto;
}
