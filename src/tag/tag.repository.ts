import { PrismaService } from '@lib/prisma';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Tag } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

@Injectable()
export class TagRepository {
  private readonly logger = new Logger(TagRepository.name);
  constructor(private readonly prismaService: PrismaService) {}

  async findAllTags(): Promise<Tag[]> {
    this.logger.log('findAllTags');
    return this.prismaService.tag
      .findMany()
      .catch((err) => {
        this.logger.error(err);
        throw new InternalServerErrorException();
      })
      .then((tags) => {
        this.logger.log('findAllTags: ' + tags.length);
        return tags;
      });
  }

  async findTag({ name }: Pick<Tag, 'name'>): Promise<Tag> {
    this.logger.log('findTag');
    return this.prismaService.tag
      .findUniqueOrThrow({
        where: { name },
      })
      .catch((err) => {
        if (err instanceof PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            this.logger.debug(`tag with name ${name} not found`);
            throw new NotFoundException(`tag with name ${name} not found`);
          }
        }
        this.logger.error('findTag error');
        this.logger.debug(err);
        throw new InternalServerErrorException();
      })
      .then((tag) => {
        this.logger.log('findTag: ' + tag);
        return tag;
      });
  }

  async searchTags({ name }: Pick<Tag, 'name'>): Promise<Tag[]> {
    return this.prismaService.tag
      .findMany({
        where: {
          name: {
            contains: name,
          },
        },
      })
      .catch((err) => {
        this.logger.error(err);
        throw new InternalServerErrorException();
      })
      .then((tags) => {
        this.logger.log('searchTags: ' + tags.length);
        return tags;
      });
  }

  async createTag({ name }: Pick<Tag, 'name'>): Promise<Tag> {
    this.logger.log('createTag');
    return this.prismaService.tag
      .create({
        data: {
          name,
        },
      })
      .catch((err) => {
        this.logger.error(err);
        throw new InternalServerErrorException();
      })
      .then((tag) => {
        this.logger.log('createTag: ' + tag);
        return tag;
      });
  }

  async deleteTag({ id }: Pick<Tag, 'id'>): Promise<void> {
    await this.prismaService.tag.delete({ where: { id } }).catch((err) => {
      if (err instanceof PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
          this.logger.error('Tag not found');
        }
      }
      this.logger.error(err);
      throw new InternalServerErrorException();
    });
  }
}
