import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateCrawlDto } from './dto/req/createCrawl.dto';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Crawl, User } from '@prisma/client';
import { GetCrawlDto } from './dto/req/getCrawl.dto';
import { PrismaService } from '@lib/prisma';

@Injectable()
export class CrawlRepository {
  private readonly logger = new Logger(CrawlRepository.name);
  constructor(private readonly prismaService: PrismaService) {}

  async getCrawlData({ url }: GetCrawlDto): Promise<Crawl | null> {
    this.logger.log('getCrawlData');
    return this.prismaService.crawl
      .findFirst({
        where: {
          url,
        },
      })
      .catch((error) => {
        if (error instanceof PrismaClientKnownRequestError) {
          this.logger.error(error);
          throw new InternalServerErrorException('database error');
        }
        this.logger.error(error);
        throw new InternalServerErrorException('unknown error');
      });
  }

  async createCrawl(
    { title, body, type, url, createdAt }: CreateCrawlDto,
    deadline: Date | null,
    user: User,
  ): Promise<Crawl> {
    this.logger.log('createCrawl');
    return this.prismaService.crawl
      .create({
        data: {
          title,
          body,
          type,
          url,
          crawledAt: createdAt,
          notice: {
            create: {
              category: 'ACADEMIC',
              currentDeadline: deadline,
              author: {
                connect: user,
              },
              publishedAt: new Date(),
            },
          },
        },
        include: {
          notice: true,
        },
      })
      .catch((error) => {
        if (error instanceof PrismaClientKnownRequestError) {
          this.logger.error(error);
          throw new InternalServerErrorException('database error');
        }
        this.logger.error(error);
        throw new InternalServerErrorException('unknown error');
      });
  }

  async updateCrawl(
    { title, body, type }: CreateCrawlDto,
    id: number,
  ): Promise<Crawl> {
    this.logger.log('updateCrawl');
    return this.prismaService.crawl
      .update({
        where: {
          id,
        },
        data: {
          title,
          body,
          type,
        },
      })
      .catch((error) => {
        if (error instanceof PrismaClientKnownRequestError) {
          this.logger.error(error);
          throw new InternalServerErrorException('database error');
        }
        this.logger.error(error);
        throw new InternalServerErrorException('unknown error');
      });
  }
}
