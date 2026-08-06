import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

// Zod validation at every API boundary — the master-prompt invariant, not
// class-validator decorator ceremony. One reusable pipe, one schema per
// endpoint.
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
