import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

// Validates a request body with a zod schema and returns the parsed (normalised) value.
// Type the @Body() parameter as a zod-inferred type, not a class, so the global
// ValidationPipe sees `Object` and leaves the body alone.
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({ message: 'Invalid tenant', issues: z.flattenError(result.error) });
    }
    return result.data;
  }
}
