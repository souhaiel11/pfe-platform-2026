import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { json, urlencoded } from 'body-parser';

async function bootstrap() {
  // bodyParser: false désactive les parseurs par défaut de NestJS (limite 100kb)
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Nos parseurs avec une limite large (rapports DevSecOps volumineux)
  app.use(json({ limit: '100mb' }));
  app.use(urlencoded({ limit: '100mb', extended: true }));

  app.enableCors({ origin: '*', credentials: true });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('DevSecOps Platform API')
    .setVersion('2.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`🚀 DevSecOps Platform API running on port ${port}`);
}

bootstrap();
