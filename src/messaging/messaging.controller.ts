import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MessagingService } from './messaging.service';
import {
  ConversationListQueryDto,
  ConversationLookupQueryDto,
  MessageListQueryDto,
  NumberShareRespondBodyDto,
  PatchMessagesReadBodyDto,
  PostConversationBodyDto,
  PostMessageBodyDto,
  PostRejectConversationBodyDto,
} from './schemas/messaging.schemas';

@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: UserDto, @Query() query: ConversationListQueryDto) {
    return this.messaging.listConversations(user, query);
  }

  @Post()
  create(@CurrentUser() user: UserDto, @Body() body: PostConversationBodyDto) {
    return this.messaging.createConversation(user, body);
  }

  @Get('lookup')
  @Header('Cache-Control', 'no-store')
  lookup(@CurrentUser() user: UserDto, @Query() query: ConversationLookupQueryDto) {
    return this.messaging.lookupConversationWithParticipant(user, query.otherUserId);
  }

  @Get('sent-requests')
  @Header('Cache-Control', 'no-store')
  listSentRequests(@CurrentUser() user: UserDto) {
    return this.messaging.listSentRequests(user);
  }

  @Get(':conversationId')
  @Header('Cache-Control', 'no-store')
  getOne(@CurrentUser() user: UserDto, @Param('conversationId') conversationId: string) {
    return this.messaging.getConversation(user, conversationId);
  }

  @Get(':conversationId/messages')
  @Header('Cache-Control', 'no-store')
  listMessages(
    @CurrentUser() user: UserDto,
    @Param('conversationId') conversationId: string,
    @Query() query: MessageListQueryDto,
  ) {
    return this.messaging.listMessages(user, conversationId, query);
  }

  @Post(':conversationId/accept')
  accept(@CurrentUser() user: UserDto, @Param('conversationId') conversationId: string) {
    return this.messaging.acceptConversationRequest(user, conversationId);
  }

  @Post(':conversationId/reject')
  reject(
    @CurrentUser() user: UserDto,
    @Param('conversationId') conversationId: string,
    @Body() body: PostRejectConversationBodyDto,
  ) {
    return this.messaging.rejectConversationRequest(user, conversationId, body);
  }

  @Post(':conversationId/messages')
  send(
    @CurrentUser() user: UserDto,
    @Param('conversationId') conversationId: string,
    @Body() body: PostMessageBodyDto,
  ) {
    return this.messaging.sendMessage(user, conversationId, body);
  }

  @Patch(':conversationId/messages/read')
  markRead(
    @CurrentUser() user: UserDto,
    @Param('conversationId') conversationId: string,
    @Body() body: PatchMessagesReadBodyDto,
  ) {
    return this.messaging.markMessagesRead(user, conversationId, body);
  }

  @Post(':conversationId/number-share/request')
  numberShareRequest(@CurrentUser() user: UserDto, @Param('conversationId') conversationId: string) {
    return this.messaging.requestNumberShare(user, conversationId);
  }

  @Post(':conversationId/number-share/respond')
  numberShareRespond(
    @CurrentUser() user: UserDto,
    @Param('conversationId') conversationId: string,
    @Body() body: NumberShareRespondBodyDto,
  ) {
    return this.messaging.respondNumberShare(user, conversationId, body);
  }
}
