import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The parsed JSON body, untouched. Custom param decorators are skipped by the
 * global ValidationPipe (validateCustomDecorators defaults to false), so the
 * handler must validate it itself — see parsePageUpdateBody().
 */
export const RawBody = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().body as unknown;
});
