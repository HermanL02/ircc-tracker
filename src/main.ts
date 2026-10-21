import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { API_KEY_HEADER } from './common/guards/api-key.guard.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  const docs = new DocumentBuilder()
    .setTitle('IRCC Tracker API')
    .setDescription('Checks an IRCC application on a schedule and records every change')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: API_KEY_HEADER, in: 'header' }, 'api-key')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, docs));

  await app.listen(process.env.PORT ?? 3000, process.env.HOST ?? '0.0.0.0');
}
await bootstrap();
