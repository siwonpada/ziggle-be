import { HttpService } from '@nestjs/axios';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import cheerio from 'cheerio';
import dayjs from 'dayjs';
import { htmlToText } from 'html-to-text';
import {
  catchError,
  concatMap,
  filter,
  firstValueFrom,
  from,
  groupBy,
  identity,
  lastValueFrom,
  map,
  mergeMap,
  ObservedValueOf,
  range,
  take,
  throwError,
  timeout,
  toArray,
} from 'rxjs';
import { FcmService } from 'src/global/service/fcm.service';
import { ImageService } from 'src/image/image.service';
import { TagService } from 'src/tag/tag.service';
import { UserService } from 'src/user/user.service';
import { AdditionalNoticeDto } from './dto/additionalNotice.dto';
import { CreateNoticeDto } from './dto/createNotice.dto';
import { ForeignContentDto } from './dto/foreignContent.dto';
import { GetAllNoticeQueryDto } from './dto/getAllNotice.dto';
import { NoticeRepository } from './notice.repository';
import { GetNoticeDto } from './dto/getNotice.dto';
import { NoticeFullcontent } from './types/noticeFullcontent';
import { UpdateNoticeDto } from './dto/updateNotice.dto';
import { DocumentService } from 'src/document/document.service';
import { ReactionDto } from './dto/reaction.dto';
import { FileType } from '@prisma/client';
import { NoticeReturn } from './types/noticeReturn.type';
import {
  ExpandedGeneralNotice,
  GeneralNotice,
  GeneralNoticeList,
  GeneralReaction,
} from './types/generalNotice.type';

@Injectable()
export class NoticeService {
  private readonly s3Url: string;
  constructor(
    private readonly noticeRepository: NoticeRepository,
    private readonly imageService: ImageService,
    private readonly documentService: DocumentService,
    private readonly fcmService: FcmService,
    private readonly httpService: HttpService,
    private readonly tagService: TagService,
    private readonly userService: UserService,
    configService: ConfigService,
  ) {
    this.s3Url = `https://s3.${configService.get<string>(
      'AWS_S3_REGION',
    )}.amazonaws.com/${configService.get<string>('AWS_S3_BUCKET_NAME')}/`;
  }

  async getNoticeList(
    getAllNoticeQueryDto: GetAllNoticeQueryDto,
    userUuid?: string,
  ): Promise<GeneralNoticeList> {
    const notices = (
      await this.noticeRepository.getNoticeList(
        { lang: getAllNoticeQueryDto.lang ?? 'ko', ...getAllNoticeQueryDto },
        userUuid,
      )
    ).map(
      async ({
        id,
        author,
        createdAt,
        tags,
        views,
        contents,
        cralws,
        files,
        reactions,
        reminders,
      }): Promise<GeneralNotice> => {
        const resultReaction = await firstValueFrom(
          from(reactions).pipe(
            groupBy(({ emoji }) => emoji),
            mergeMap((group) => group.pipe(toArray())),
            toArray(),
          ),
        );
        const mainContent =
          contents.filter(
            ({ lang }) => lang === (getAllNoticeQueryDto.lang ?? 'ko'),
          )[0] ?? contents[0];
        return {
          id,
          ...(cralws.length > 0
            ? {
                title: cralws[0].title,
                lang: 'ko',
                content: htmlToText(
                  cralws[cralws.length - 1].body.slice(0, 1000),
                  {
                    selectors: [
                      { selector: 'a', options: { ignoreHref: true } },
                    ],
                  },
                ),
              }
            : {
                title: mainContent.title,
                deadline: mainContent.deadline?.toISOString(),
                lang: mainContent.lang,
                content: htmlToText(mainContent.body, {
                  selectors: [{ selector: 'a', options: { ignoreHref: true } }],
                }),
              }),
          author: author.name,
          createdAt: createdAt.toISOString(),
          tags: tags.map(({ name }) => name),
          views,
          imageUrls: files
            ?.filter(({ type }) => type === FileType.IMAGE)
            .map(({ url }) => `${this.s3Url}${url}`),
          documentUrls: files
            ?.filter(({ type }) => type === FileType.DOCUMENT)
            .map(({ url }) => `${this.s3Url}${url}`),
          isReminded: reminders.some(({ uuid }) => uuid === userUuid),
          reactions: resultReaction.map((reactions) => ({
            emoji: reactions[0].emoji,
            count: reactions.length,
            isReacted: reactions.some(({ userId }) => userId === userUuid),
          })),
        };
      },
    );
    return {
      total: await this.noticeRepository.getTotalCount(
        { lang: getAllNoticeQueryDto.lang ?? 'ko', ...getAllNoticeQueryDto },
        userUuid,
      ),
      list: await Promise.all(notices),
    };
  }

  async getNotice(
    id: number,
    { isViewed }: GetNoticeDto,
    userUuid?: string,
  ): Promise<ExpandedGeneralNotice> {
    let notice: NoticeFullcontent;
    if (isViewed) {
      notice = await this.noticeRepository.getNoticeWithView(id);
    } else {
      notice = await this.noticeRepository.getNotice(id);
    }
    const {
      createdAt,
      tags,
      views,
      contents,
      cralws,
      author,
      files,
      reactions,
      reminders,
    } = notice;
    const resultReaction = await firstValueFrom(
      from(reactions).pipe(
        groupBy(({ emoji }) => emoji),
        mergeMap((group) => group.pipe(toArray())),
        toArray(),
      ),
    );
    const mainContent =
      contents.filter(({ lang }) => lang === 'ko')[0] ?? contents[0];
    return {
      id,
      ...(cralws.length > 0
        ? {
            title: cralws[0].title,
            lang: 'ko',
            content: htmlToText(cralws[cralws.length - 1].body, {
              selectors: [{ selector: 'a', options: { ignoreHref: true } }],
            }),
          }
        : {
            title: mainContent.title,
            deadline: mainContent.deadline?.toISOString(),
            lang: mainContent.lang,
            content: htmlToText(mainContent.body, {
              selectors: [{ selector: 'a', options: { ignoreHref: true } }],
            }),
          }),
      author: author.name,
      createdAt: createdAt.toISOString(),
      tags: tags.map(({ name }) => name),
      views,
      imageUrls: files
        ?.filter(({ type }) => type === FileType.IMAGE)
        .map(({ url }) => `${this.s3Url}${url}`),
      documentUrls: files
        ?.filter(({ type }) => type === FileType.DOCUMENT)
        .map(({ url }) => `${this.s3Url}${url}`),
      additionalContent: notice.contents
        .filter(({ id }) => id !== 1)
        .map(({ body, deadline, lang }) => ({
          content: htmlToText(body, {
            selectors: [{ selector: 'a', options: { ignoreHref: true } }],
          }),
          deadline: deadline?.toISOString(),
          lang,
        })),
      isReminded: reminders.some(({ uuid }) => uuid === userUuid),
      reactions: resultReaction.map((reactions) => ({
        emoji: reactions[0].emoji,
        count: reactions.length,
        isReacted: reactions.some(({ userId }) => userId === userUuid),
      })),
    };
  }

  async createNotice(
    { title, body, deadline, tags, images, documents }: CreateNoticeDto,
    userUuid: string,
  ) {
    if (images.length) {
      await this.imageService.validateImages(images);
    }
    if (documents.length) {
      await this.documentService.validateDocuments(documents);
    }

    const notice = await this.noticeRepository.createNotice(
      {
        title,
        body,
        deadline,
        tags,
        images,
        documents,
      },
      userUuid,
    );

    this.sendNoticeToAllUsers(
      title,
      images?.map((image) => `${this.s3Url}${image}`),
      notice,
    );
    return this.getNotice(notice.id, { isViewed: false });
  }

  async addNoticeAdditional(
    { title, body, deadline, to }: AdditionalNoticeDto,
    id: number,
    userUuid: string,
  ) {
    await this.noticeRepository.addAdditionalNotice(
      {
        title,
        body,
        deadline,
      },
      id,
      userUuid,
    );
    if (to) {
      this.fcmService.postMessage(
        {
          title: '공지글이 추가되었습니다.',
          body: title,
        },
        to === 'all'
          ? (await this.noticeRepository.getAllFcmTokens()).map(
              ({ token }) => token,
            )
          : (await this.noticeRepository.getFcmTokensByNoticeId(id)).map(
              ({ token }) => token,
            ),
        { path: `/root/article?id=${id}` },
      );
    }

    return this.getNotice(id, { isViewed: false });
  }

  async addForeignContent(
    { lang, title, body, deadline }: ForeignContentDto,
    id: number,
    idx: number,
    userUuid: string,
  ) {
    await this.noticeRepository.addForeignContent(
      { lang, title, body, deadline },
      id,
      idx,
      userUuid,
    );
    return this.getNotice(id, { isViewed: false });
  }

  async addNoticeReminder(id: number, userUuid: string) {
    await this.noticeRepository.addReminder(id, userUuid);

    return this.getNotice(id, { isViewed: false }, userUuid);
  }

  async addNoticeReaction(
    id: number,
    { emoji }: ReactionDto,
    userUuid: string,
  ) {
    await this.noticeRepository.addReaction(id, emoji, userUuid);

    return this.getNotice(id, { isViewed: false }, userUuid);
  }

  async updateNotice(id: number, body: UpdateNoticeDto, userUuid: string) {
    const notice = await this.noticeRepository.getNotice(id);
    if (notice.author.uuid !== userUuid) {
      throw new ForbiddenException();
    }
    if (notice.createdAt.getTime() + 15 * 60 * 1000 < Date.now()) {
      throw new ForbiddenException();
    }
    await this.noticeRepository.updateNotice(id, body, userUuid);
    return this.getNotice(id, { isViewed: false }, userUuid);
  }

  async removeNoticeReminder(id: number, userUuid: string) {
    await this.noticeRepository.removeReminder(id, userUuid);

    return this.getNotice(id, { isViewed: false }, userUuid);
  }

  async removeNoticeReaction(
    id: number,
    { emoji }: ReactionDto,
    userUuid: string,
  ) {
    await this.noticeRepository.removeReaction(id, emoji, userUuid);

    return this.getNotice(id, { isViewed: false }, userUuid);
  }

  async deleteNotice(id: number, userUuid: string): Promise<void> {
    const notice = await this.noticeRepository.getNotice(id);
    this.imageService.deleteImages(notice.files.map(({ url }) => url));
    await this.noticeRepository.deleteNotice(id, userUuid);
  }

  @Cron('0 9 * * *')
  async sendReminderMessage() {
    const targetNotices = await this.noticeRepository.getNoticeByTime(
      new Date(),
    );
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

  private getAcademicNoticeList() {
    const baseUrl = 'https://www.gist.ac.kr/kr/html/sub05/050209.html';
    return range(1).pipe(
      map((n) => `${baseUrl}?GotoPage=${n + 1}`),
      concatMap((url) => this.httpService.get(url)),
      timeout(10000),
      map((res) => cheerio.load(res.data)),
      catchError(throwError),
      map(($) => $('table > tbody > tr')),
      concatMap(($) => $.toArray().map(cheerio)),
      map(($) => ({
        title: $.find('td').eq(2).text().trim(),
        link: `${baseUrl}${$.find('td').eq(2).find('a').attr('href')}`,
        author: $.find('td').eq(3).text().trim(),
        category: $.find('td').eq(1).text().trim(),
        createdAt: $.find('td').eq(5).text().trim(),
      })),
      map((meta) => ({
        id: Number.parseInt(meta.link.split('no=')[1].split('&')[0]),
        ...meta,
      })),
    );
  }

  private getAcademicNotice({
    link,
  }: ObservedValueOf<ReturnType<typeof this.getAcademicNoticeList>>) {
    const baseUrl = 'https://www.gist.ac.kr/kr/html/sub05/050209.html';
    return this.httpService.get(link).pipe(
      timeout(10000),
      map((res) => res.data),
      map((e) => cheerio.load(e)),
      catchError(throwError),
      map(($) => {
        const files = $('.bd_detail_file > ul > li > a')
          .toArray()
          .map((e) => ({
            href: `${baseUrl}${$(e).attr('href')}`,
            name: $(e).text().trim(),
            type: $(e).attr('class') as
              | 'doc'
              | 'hwp'
              | 'pdf'
              | 'imgs'
              | 'xls'
              | 'etc',
          }));
        const content = $('.bd_detail_content').html().trim();
        return { files, content };
      }),
    );
  }

  @Cron('*/5 * * * *')
  async crawlAcademicNotice() {
    const $ = this.getAcademicNoticeList().pipe(
      take(100),
      timeout(60e3),
      concatMap((meta) =>
        this.getAcademicNotice(meta).pipe(map((notice) => ({ notice, meta }))),
      ),
      map(async (notice) => {
        const prev = await this.noticeRepository.getAcademicNotice(
          notice.meta.link,
        );
        return { prev, notice };
      }),
      concatMap(identity),
      filter(({ prev, notice: { notice, meta } }) => {
        if (!prev) return true;
        if (prev.cralws[0].title !== meta.title) return true;
        if (prev.cralws[0].body !== notice.content) return true;
        return false;
      }),
      concatMap(async ({ prev, notice: { notice, meta } }) => {
        const tags = await this.tagService.findOrCreateTags([
          'academic',
          meta.category,
        ]);
        const user = await this.userService.addTempUser(
          `${meta.author} (${meta.category})`,
        );
        const imagesStream = from(
          cheerio.load(notice.content)('img').toArray(),
        ).pipe(
          map((e) => e.type === 'tag' && e.attribs.src),
          concatMap((v) =>
            this.httpService.get(v, { responseType: 'arraybuffer' }),
          ),
          map(
            (res, index) =>
              ({
                buffer: res.data,
                originalname: `${meta.id}-${meta.title}-${index}.${
                  res.headers['content-type'].split('/')[1].split(';')[0]
                }`,
              } as Express.Multer.File),
          ),
          toArray(),
        );
        const images = await this.imageService.uploadImages(
          await firstValueFrom(imagesStream),
        );
        const result = await this.noticeRepository.createAcademicNotice({
          title: meta.title,
          body: notice.content,
          images,
          documents: notice.files,
          tags,
          userUuid: user.uuid,
          createdAt: dayjs(meta.createdAt)
            .tz()
            .add(dayjs().tz().diff(dayjs().tz().startOf('d')))
            .toDate(),
          url: meta.link,
        });
        if (!prev) await this.sendNoticeToAllUsers(meta.title, [], result);
      }),
    );
    await lastValueFrom($, { defaultValue: null });
  }

  private async sendNoticeToAllUsers(
    title: string,
    images: string[],
    notice: Awaited<ReturnType<NoticeRepository['createNotice']>>,
  ) {
    await this.fcmService.postMessage(
      {
        title: '새 공지글',
        body: title,
        imageUrl: images?.length ? images[0] : undefined,
      },
      (await this.noticeRepository.getAllFcmTokens()).map(({ token }) => token),
      { path: `/root/article?id=${notice.id}` },
    );
  }
}
