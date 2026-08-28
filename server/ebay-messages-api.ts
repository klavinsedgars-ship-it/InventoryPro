import { ebayOAuth } from './ebay-oauth';

// Rate limiter for eBay Trading API (75 calls per 60 seconds)
class RateLimiter {
  private callTimestamps: number[] = [];
  private readonly maxCalls: number;
  private readonly windowMs: number;

  constructor(maxCalls: number = 75, windowMs: number = 60000) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    
    // Remove timestamps outside the window
    this.callTimestamps = this.callTimestamps.filter(ts => now - ts < this.windowMs);
    
    if (this.callTimestamps.length >= this.maxCalls) {
      // Wait until the oldest call expires
      const oldestCall = this.callTimestamps[0];
      const waitTime = this.windowMs - (now - oldestCall) + 100; // +100ms buffer
      console.log(`Rate limit reached, waiting ${waitTime}ms before next API call`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquire(); // Retry after waiting
    }
    
    this.callTimestamps.push(now);
  }

  getRemaining(): number {
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(ts => now - ts < this.windowMs);
    return this.maxCalls - this.callTimestamps.length;
  }
}

const tradingApiRateLimiter = new RateLimiter(75, 60000);

interface EbayMessage {
  /** Original HTML from eBay, kept so the UI can render real formatting. */
  bodyHtml?: string;
  messageId: string;
  subject: string;
  body: string;
  sender: string;
  senderEmail?: string;
  recipientUserId: string;
  itemId?: string;
  itemTitle?: string;
  creationDate: string;
  messageType: string;
  isRead: boolean;
  flagged: boolean;
  responseEnabled: boolean;
  externalMessageId?: string;
}

interface GetMessagesResponse {
  success: boolean;
  messages: EbayMessage[];
  hasMoreMessages: boolean;
  totalCount?: number;
  error?: string;
}

interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

const TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';

async function makeXmlRequest(callName: string, xmlBody: string, retries: number = 3): Promise<string> {
  // Acquire rate limit slot before making request
  await tradingApiRateLimiter.acquire();
  
  const token = await ebayOAuth.getValidAccessToken();
  
  const headers = {
    'Content-Type': 'text/xml',
    'X-EBAY-API-SITEID': process.env.EBAY_MARKETPLACE_SITE_ID || '77',
    'X-EBAY-API-COMPATIBILITY-LEVEL': '1225',
    'X-EBAY-API-CALL-NAME': callName,
    'X-EBAY-API-IAF-TOKEN': token,
  };

  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(TRADING_API_URL, {
        method: 'POST',
        headers,
        body: xmlBody,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response.text();
    } catch (error) {
      lastError = error as Error;
      console.warn(`eBay API request attempt ${attempt}/${retries} failed:`, (error as Error).message);
      
      if (attempt < retries) {
        // Wait before retry (exponential backoff)
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError || new Error('Request failed after all retries');
}

function parseXmlValue(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, 's');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtmlTags(html: string): string {
  // Decode HTML entities first
  let text = decodeHtmlEntities(html);
  
  // Remove entire style blocks including content
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Remove entire script blocks including content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  // Remove head section entirely
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // Remove DOCTYPE and XML declarations
  text = text.replace(/<!DOCTYPE[^>]*>/gi, '');
  text = text.replace(/<\?xml[^>]*\?>/gi, '');
  
  // Replace common block elements with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode entities again (in case tags contained entities)
  text = decodeHtmlEntities(text);
  
  // Clean up whitespace
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n'); // Max 2 newlines
  text = text.replace(/[ \t]+/g, ' '); // Collapse spaces
  text = text.trim();
  
  return text;
}

function cleanMessageBody(rawBody: string): string {
  if (!rawBody) return '';
  
  // Check if it looks like HTML
  if (rawBody.includes('<') || rawBody.includes('&lt;')) {
    return stripHtmlTags(rawBody);
  }
  
  return rawBody.trim();
}

function parseXmlArray(xml: string, containerTag: string, itemTag: string): string[] {
  const containerRegex = new RegExp(`<${containerTag}>(.*?)</${containerTag}>`, 'gs');
  const results: string[] = [];
  let match;
  while ((match = containerRegex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

export async function getMyMessages(
  startTime?: Date,
  endTime?: Date,
  folderType: 'Inbox' | 'Sent' | 'All' = 'Inbox',
  limit: number = 100,
  pageNumber: number = 1
): Promise<GetMessagesResponse> {
  try {
    const startTimeStr = startTime ? startTime.toISOString() : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endTimeStr = endTime ? endTime.toISOString() : new Date().toISOString();

    console.log(`📬 Fetching eBay messages page ${pageNumber} (limit: ${limit})...`);

    // Step 1: Get message headers (IDs) first
    const headersRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnHeaders</DetailLevel>
  <StartTime>${startTimeStr}</StartTime>
  <EndTime>${endTimeStr}</EndTime>
  <Pagination>
    <EntriesPerPage>${limit}</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
</GetMyMessagesRequest>`;

    const headersResponse = await makeXmlRequest('GetMyMessages', headersRequest);
    
    let ack = parseXmlValue(headersResponse, 'Ack');
    if (ack !== 'Success' && ack !== 'Warning') {
      const errorMessage = parseXmlValue(headersResponse, 'LongMessage') || parseXmlValue(headersResponse, 'ShortMessage') || 'Unknown error';
      console.error('GetMyMessages (headers) failed:', errorMessage);
      return { success: false, messages: [], hasMoreMessages: false, error: errorMessage };
    }

    // Extract message IDs from headers
    const headerBlocks = parseXmlArray(headersResponse, 'Message', 'Message');
    const messageIds: string[] = [];
    
    for (const block of headerBlocks) {
      const messageId = parseXmlValue(block, 'MessageID');
      if (messageId) {
        messageIds.push(messageId);
      }
    }

    if (messageIds.length === 0) {
      console.log('No messages found in the specified time range');
      return { success: true, messages: [], hasMoreMessages: false, totalCount: 0 };
    }

    console.log(`Found ${messageIds.length} message IDs, fetching full messages in batches of 10...`);

    // Step 2: Get full message content using the IDs (batch of 10 max per eBay API limit)
    const messages: EbayMessage[] = [];
    const BATCH_SIZE = 10;
    
    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
      const batchIds = messageIds.slice(i, i + BATCH_SIZE);
      const messageIdsXml = batchIds.map(id => `<MessageID>${id}</MessageID>`).join('\n    ');
      
      console.log(`Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(messageIds.length / BATCH_SIZE)} (${batchIds.length} messages)...`);
      
      const messagesRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnMessages</DetailLevel>
  <MessageIDs>
    ${messageIdsXml}
  </MessageIDs>
</GetMyMessagesRequest>`;

      const messagesResponse = await makeXmlRequest('GetMyMessages', messagesRequest);
      
      ack = parseXmlValue(messagesResponse, 'Ack');
      if (ack !== 'Success' && ack !== 'Warning') {
        const errorMessage = parseXmlValue(messagesResponse, 'LongMessage') || parseXmlValue(messagesResponse, 'ShortMessage') || 'Unknown error';
        console.error('GetMyMessages (messages) failed:', errorMessage);
        continue; // Skip this batch but continue with others
      }

      const messageBlocks = parseXmlArray(messagesResponse, 'Message', 'Message');
      
      for (const block of messageBlocks) {
        const rawBody = parseXmlValue(block, 'Text') || parseXmlValue(block, 'Content') || '';
        const message: EbayMessage = {
          messageId: parseXmlValue(block, 'MessageID') || '',
          subject: cleanMessageBody(parseXmlValue(block, 'Subject') || '(No Subject)'),
          body: cleanMessageBody(rawBody),
          // The flattened text loses every paragraph break and leaves literal
          // "&nbsp;" on screen; keep the source so the UI can render it.
          bodyHtml: rawBody || undefined,
          sender: parseXmlValue(block, 'Sender') || '',
          senderEmail: parseXmlValue(block, 'SenderEmail') || undefined,
          recipientUserId: parseXmlValue(block, 'RecipientUserID') || '',
          itemId: parseXmlValue(block, 'ItemID') || undefined,
          itemTitle: parseXmlValue(block, 'ItemTitle') || undefined,
          creationDate: parseXmlValue(block, 'CreationDate') || parseXmlValue(block, 'ReceiveDate') || new Date().toISOString(),
          messageType: parseXmlValue(block, 'MessageType') || 'Unknown',
          isRead: parseXmlValue(block, 'Read') === 'true',
          flagged: parseXmlValue(block, 'Flagged') === 'true',
          responseEnabled: parseXmlValue(block, 'ResponseEnabled') === 'true',
          externalMessageId: parseXmlValue(block, 'ExternalMessageID') || undefined,
        };
        messages.push(message);
      }
    }

    const hasMore = parseXmlValue(headersResponse, 'HasMoreMessages') === 'true';
    const totalCount = parseInt(parseXmlValue(headersResponse, 'TotalNumberOfMessages') || '0', 10);

    console.log(`Retrieved ${messages.length} full messages from eBay`);
    return { success: true, messages, hasMoreMessages: hasMore, totalCount };
  } catch (error) {
    console.error('Error fetching eBay messages:', error);
    return { success: false, messages: [], hasMoreMessages: false, error: (error as Error).message };
  }
}

export async function getMemberMessages(
  itemId?: string,
  mailMessageType: 'All' | 'AskSellerQuestion' = 'All',
  messageStatus: 'All' | 'Answered' | 'Unanswered' = 'All',
  startTime?: Date,
  limit: number = 100
): Promise<GetMessagesResponse> {
  try {
    let filters = '';
    if (itemId) {
      filters += `<ItemID>${itemId}</ItemID>`;
    }
    if (startTime) {
      filters += `<StartCreationTime>${startTime.toISOString()}</StartCreationTime>`;
    }

    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <MailMessageType>${mailMessageType}</MailMessageType>
  <MessageStatus>${messageStatus}</MessageStatus>
  ${filters}
  <Pagination>
    <EntriesPerPage>${limit}</EntriesPerPage>
    <PageNumber>1</PageNumber>
  </Pagination>
</GetMemberMessagesRequest>`;

    const response = await makeXmlRequest('GetMemberMessages', xmlRequest);
    
    const ack = parseXmlValue(response, 'Ack');
    if (ack !== 'Success' && ack !== 'Warning') {
      const errorMessage = parseXmlValue(response, 'LongMessage') || parseXmlValue(response, 'ShortMessage') || 'Unknown error';
      console.error('GetMemberMessages failed:', errorMessage);
      return { success: false, messages: [], hasMoreMessages: false, error: errorMessage };
    }

    const messages: EbayMessage[] = [];
    const memberMessageBlocks = parseXmlArray(response, 'MemberMessage', 'MemberMessage');
    
    for (const block of memberMessageBlocks) {
      const itemId = parseXmlValue(block, 'ItemID') || undefined;
      const questionBlock = parseXmlValue(block, 'Question') || block;

      const question: EbayMessage = {
        messageId: parseXmlValue(questionBlock, 'MessageID') || '',
        subject: parseXmlValue(questionBlock, 'Subject') || '(No Subject)',
        // GetMemberMessages gives the MESSAGE, not an email about it: this is
        // the buyer's own words, with no wrapper to strip.
        body: parseXmlValue(questionBlock, 'Body') || '',
        sender: parseXmlValue(questionBlock, 'SenderID') || '',
        senderEmail: parseXmlValue(questionBlock, 'SenderEmail') || undefined,
        recipientUserId: parseXmlValue(questionBlock, 'RecipientID') || '',
        itemId,
        itemTitle: undefined,
        creationDate: parseXmlValue(questionBlock, 'CreationDate') || new Date().toISOString(),
        messageType: parseXmlValue(questionBlock, 'QuestionType') || 'General',
        isRead: false,
        flagged: false,
        responseEnabled: true,
      };
      if (question.body || question.messageId) messages.push(question);

      // Our own replies come back in the same envelope. Without them the
      // thread shows only half the conversation.
      for (const responseBlock of parseXmlArray(block, 'Response', 'Response')) {
        const replyId = parseXmlValue(responseBlock, 'MessageID') || '';
        const replyBody = parseXmlValue(responseBlock, 'Body') || '';
        if (!replyBody && !replyId) continue;
        messages.push({
          messageId: replyId || `${question.messageId}-r`,
          subject: parseXmlValue(responseBlock, 'Subject') || question.subject,
          body: replyBody,
          sender: parseXmlValue(responseBlock, 'SenderID') || '',
          recipientUserId: parseXmlValue(responseBlock, 'RecipientID') || question.sender,
          itemId,
          itemTitle: undefined,
          creationDate: parseXmlValue(responseBlock, 'CreationDate') || question.creationDate,
          messageType: 'Response',
          isRead: true,
          flagged: false,
          responseEnabled: false,
        });
      }
    }

    const hasMore = parseXmlValue(response, 'HasMoreItems') === 'true';

    console.log(`Retrieved ${messages.length} member messages from eBay`);
    return { success: true, messages, hasMoreMessages: hasMore };
  } catch (error) {
    console.error('Error fetching eBay member messages:', error);
    return { success: false, messages: [], hasMoreMessages: false, error: (error as Error).message };
  }
}

export async function sendMessageToPartner(
  itemId: string,
  recipientId: string,
  body: string,
  subject?: string,
  questionType: 'General' | 'Shipping' | 'Payment' = 'General'
): Promise<SendMessageResponse> {
  try {
    if (!ebayOAuth.isOAuthConfigured()) {
      return { success: false, error: 'eBay OAuth not configured' };
    }

    const subjectLine = subject || 'Message from seller';
    
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${escapeXml(itemId)}</ItemID>
  <MemberMessage>
    <Subject>${escapeXml(subjectLine)}</Subject>
    <Body>${escapeXml(body)}</Body>
    <QuestionType>${questionType}</QuestionType>
    <RecipientID>${escapeXml(recipientId)}</RecipientID>
    <EmailCopyToSender>true</EmailCopyToSender>
  </MemberMessage>
</AddMemberMessageAAQToPartnerRequest>`;

    const response = await makeXmlRequest('AddMemberMessageAAQToPartner', xmlRequest);
    
    const ack = parseXmlValue(response, 'Ack');
    if (ack !== 'Success' && ack !== 'Warning') {
      const errorMessage = parseXmlValue(response, 'LongMessage') || parseXmlValue(response, 'ShortMessage') || 'Unknown error';
      console.error('SendMessage failed:', errorMessage);
      return { success: false, error: errorMessage };
    }

    console.log(`Message sent to ${recipientId} successfully`);
    return { success: true };
  } catch (error) {
    console.error('Error sending eBay message:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function replyToQuestion(
  messageId: string,
  parentMessageId: string,
  recipientId: string,
  itemId: string,
  body: string,
  displayToPublic: boolean = false
): Promise<SendMessageResponse> {
  try {
    if (!ebayOAuth.isOAuthConfigured()) {
      return { success: false, error: 'eBay OAuth not configured' };
    }

    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageRTQRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${escapeXml(itemId)}</ItemID>
  <MemberMessage>
    <Body>${escapeXml(body)}</Body>
    <ParentMessageID>${escapeXml(parentMessageId)}</ParentMessageID>
    <RecipientID>${escapeXml(recipientId)}</RecipientID>
    <DisplayToPublic>${displayToPublic}</DisplayToPublic>
  </MemberMessage>
</AddMemberMessageRTQRequest>`;

    const response = await makeXmlRequest('AddMemberMessageRTQ', xmlRequest);
    
    const ack = parseXmlValue(response, 'Ack');
    if (ack !== 'Success' && ack !== 'Warning') {
      const errorMessage = parseXmlValue(response, 'LongMessage') || parseXmlValue(response, 'ShortMessage') || 'Unknown error';
      console.error('ReplyToQuestion failed:', errorMessage);
      return { success: false, error: errorMessage };
    }

    console.log(`Reply sent successfully to message ${parentMessageId}`);
    return { success: true };
  } catch (error) {
    console.error('Error replying to eBay question:', error);
    return { success: false, error: (error as Error).message };
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(placeholder, value || '');
  }
  return result;
}

export function checkOrderMessageEligibility(orderDate: Date): { eligible: boolean; daysRemaining: number } {
  const now = new Date();
  const daysSinceOrder = Math.floor((now.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysRemaining = 90 - daysSinceOrder;
  return {
    eligible: daysSinceOrder <= 90,
    daysRemaining: Math.max(0, daysRemaining)
  };
}

export function getRateLimitStatus(): { remaining: number; maxCalls: number } {
  return {
    remaining: tradingApiRateLimiter.getRemaining(),
    maxCalls: 75
  };
}

export const ebayMessagesApi = {
  getMyMessages,
  getMemberMessages,
  sendMessageToPartner,
  replyToQuestion,
  renderTemplate,
  checkOrderMessageEligibility,
  getRateLimitStatus,
};
