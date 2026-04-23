export type ChatContext = {
  chatId: number;
  messageId?: number;
  from?: any;
};

export type CommandRouteHandler = (
  match: RegExpMatchArray,
  ctx: ChatContext,
  tgSend: any
) => Promise<void>;

export type CommandRouteSpec = {
  pattern: RegExp;
  run: CommandRouteHandler;
  userErrorLabel?: string;
  tokens?: string[];
};
