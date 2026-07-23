import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  // Same composition rule as SignupDto.password — kept in sync
  // deliberately; a reset should not let a user set a weaker password
  // than signup would have required.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  newPassword!: string;
}
