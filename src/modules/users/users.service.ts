import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from 'generated/prisma/client';
import {
  CreateLocalUserInput,
  CreateOAuthUserInput,
} from './dto/create-user.input';
import { UserResponseDto } from './dto/user-response.dto';

// NOTE: This service is currently consumed ONLY by AuthModule. There is no
// public UsersController/CRUD endpoints yet — deliberately deferred, since
// "user profile management" wasn't in this stage's scope and doesn't need
// to exist before Auth can be built. We'll revisit whether/what public
// Users endpoints are needed (e.g. GET /users/me, PATCH /users/me) once
// Auth's guards exist to protect them.
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  createLocalUser(input: CreateLocalUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        // emailVerifiedAt intentionally left null (the column default) —
        // local signups start unverified until the email-verification
        // flow completes.
      },
    });
  }

  createOAuthUser(input: CreateOAuthUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        // passwordHash stays null — this user has no local password.
        // emailVerifiedAt set immediately: Google has already verified
        // this email address, so there is nothing for us to re-verify.
        emailVerifiedAt: new Date(),
      },
    });
  }

  updatePasswordHash(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  markEmailVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  // Maps the full internal User (which includes passwordHash) down to the
  // safe public shape. Every place that returns a user to a client should
  // go through this rather than returning the Prisma entity directly.
  toResponseDto(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
    };
  }
}
