import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateNoticeDto } from './dto/createNotice.dto';
import { GetAllNoticeQueryDto } from './dto/getAllNotice.dto';
import { ImageService } from 'src/image/image.service';
import { FcmService } from 'src/global/service/fcm.service';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { htmlToText } from 'html-to-text';
import dayjs from 'dayjs';
import { PrismaService } from 'src/prisma/prisma.service';
import { FileType, Notice, User } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

@Injectable()
export class NoticeService {
  private readonly logger = new Logger(NoticeService.name);
  private readonly s3Url: string;
  constructor(
    private readonly prismaService: PrismaService,
    private readonly imageService: ImageService,
    private readonly fcmService: FcmService,
    configService: ConfigService,
  ) {
    this.s3Url = `https://s3.${configService.get<string>(
      'AWS_S3_REGION',
    )}.amazonaws.com/${configService.get<string>('AWS_S3_BUCKET_NAME')}/`;
  }

  async getNoticeList(
    getAllNoticeQueryDto: GetAllNoticeQueryDto,
    userUuid?: string,
  ) {
    const result = await this.prismaService.notice.findMany({
      take: getAllNoticeQueryDto.limit,
      skip: getAllNoticeQueryDto.offset,
      include: {
        author: true,
        contents: {
          include: {
            bodys: {
              take: 1,
            },
          },
        },
        files: {
          where: {
            type: FileType.IMAGE,
          },
        },
      },
      orderBy: {
        currentDeadline:
          getAllNoticeQueryDto.orderBy === 'deadline' ? 'desc' : undefined,
        views: getAllNoticeQueryDto.orderBy === 'hot' ? 'desc' : undefined,
        createdAt:
          getAllNoticeQueryDto.orderBy === 'recent' ? 'desc' : undefined,
      },
      where: {
        authorId: getAllNoticeQueryDto.my === 'own' ? userUuid : undefined,
        reminders: {
          some: {
            uuid:
              getAllNoticeQueryDto.my === 'reminders' ? userUuid : undefined,
          },
        },
        contents: {
          some: {
            OR: [
              {
                bodys: {
                  some: {
                    body: {
                      contains: getAllNoticeQueryDto.search,
                    },
                  },
                },
              },
              {
                title: {
                  contains: getAllNoticeQueryDto.search,
                },
              },
            ],
          },
        },
        tags: {
          some: {
            name: {
              in: getAllNoticeQueryDto.tags,
            },
          },
        },
      },
    });
    return {
      ...result,
      list: result.map(({ files, ...notice }) => ({
        ...notice,
        author: notice.author.name,
        imageUrl: files?.[0].url ? `${this.s3Url}${files[0].url}` : null,
        body: htmlToText(notice.contents[0].bodys[0].body).slice(0, 100),
      })),
    };
  }

  async getNotice(id: number, user?: User) {
    const notice = await this.prismaService.notice
      .update({
        where: { id },
        include: {
          contents: true,
          reminders: true,
          author: true,
          files: true,
        },
        data: { views: { increment: 1 } },
      })
      .catch((err) => {
        if (err instanceof PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            throw new NotFoundException(`Notice with ID "${id}" not found`);
          }
        }
        throw new InternalServerErrorException();
      });
    const { reminders, ...noticeInfo } = notice;
    return {
      ...noticeInfo,
      author: notice.author.name,
      imagesUrl: notice.files?.map((file) => `${this.s3Url}${file.url}`),
      reminder: reminders.some((reminder) => reminder.uuid === user?.uuid),
    };
  }

  async createNotice(
    { title, body, deadline, tags, images }: CreateNoticeDto,
    userUUID: string,
  ) {
    const user = await this.prismaService.user
      .findUnique({
        where: { uuid: userUUID },
      })
      .catch(() => {
        throw new NotFoundException(`User with UUID "${userUUID}" not found`);
      });
    let findTags = null;
    if (tags) {
      findTags = await this.prismaService.tag.findMany({
        where: {
          id: {
            in: tags,
          },
        },
      });
    }
    if (images) {
      await this.imageService.validateImages(images);
    }

    const notice = await this.prismaService.notice
      .create({
        data: {
          author: {
            connect: user,
          },
          contents: {
            create: {
              title,
              bodys: {
                create: {
                  lang: 'ko',
                  body,
                },
              },
              deadline: deadline || null,
            },
          },
          currentDeadline: deadline || null,
          tags: {
            connect: findTags,
          },
          files: {
            create: images?.map((image) => ({
              name: title,
              type: FileType.IMAGE,
              url: image,
            })),
          },
        },
      })
      .catch(() => {
        throw new InternalServerErrorException();
      });

    const tokens = await this.prismaService.fcmToken.findMany();
    this.fcmService.postMessage(
      {
        title: '새 공지글',
        body: title,
        imageUrl: images.length === 0 ? undefined : `${this.s3Url}${images[0]}`,
      },
      tokens.map(({ token }) => token),
      { path: `/root/article?id=${notice.id}` },
    );
    return this.getNotice(notice.id);
  }

  async addNoticeReminder(id: number, user: User): Promise<Notice> {
    return await this.prismaService.notice.update({
      where: { id },
      data: {
        reminders: {
          connect: {
            uuid: user.uuid,
          },
        },
      },
    });
  }

  async removeNoticeReminder(id: number, user: User): Promise<Notice> {
    return await this.prismaService.notice.update({
      where: { id },
      data: {
        reminders: {
          disconnect: {
            uuid: user.uuid,
          },
        },
      },
    });
  }

  async deleteNotice(id: number, userUUID: string): Promise<void> {
    const result = await this.prismaService.notice
      .delete({
        where: { id, authorId: userUUID },
        select: {
          files: {
            where: {
              type: FileType.IMAGE,
            },
          },
        },
      })
      .catch(() => {
        throw new NotFoundException(`Notice with ID "${id}" not found`);
      });
    this.imageService.deleteImages(result.files.map(({ url }) => url));
  }

  @Cron('0 9 * * *')
  async sendReminderMessage() {
    const targetNotices = await this.prismaService.notice.findMany({
      where: {
        currentDeadline: {
          gte: dayjs().startOf('d').add(1, 'd').toDate(),
          lte: dayjs().startOf('d').add(2, 'd').toDate(),
        },
      },
      include: {
        reminders: {
          include: {
            fcmTokens: true,
          },
        },
        contents: true,
        files: true,
      },
    });
    targetNotices.map((notice) => {
      const leftDate = dayjs(notice.currentDeadline)
        .startOf('d')
        .diff(dayjs().startOf('d'), 'd');
      return this.fcmService.postMessage(
        {
          title: `[Reminder] ${leftDate}일 남은 공지가 있어요!`,
          body: `${notice.contents[0].title} 마감이 ${leftDate}일 남았어요`,
          imageUrl: notice.files?.[0].url
            ? `${this.s3Url}${notice.files[0].url}`
            : undefined,
        },
        notice.reminders
          .flatMap(({ fcmTokens }) => fcmTokens)
          .map(({ token }) => token),
        { path: `/root/article?id=${notice.id}` },
      );
    });
  }
}
