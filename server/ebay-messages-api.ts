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
    'X-EBAY-API-SITEID': '3', // UK site
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
  limit: number = 100
): Promise<GetMessagesResponse> {
  try {
    const startTimeStr = startTime ? startTime.toISOString() : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endTimeStr = endTime ? endTime.toISOString() : new Date().toISOString();

    // Step 1: Get message headers (IDs) first
    const headersRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnHeaders</DetailLevel>
  <StartTime>${startTimeStr}</StartTime>
  <EndTime>${endTimeStr}</EndTime>
  <Pagination>
    <EntriesPerPage>${limit}</EntriesPerPage>
    <PageNumber>1</PageNumber>
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

    console.log(`Found ${messageIds.length} message IDs, fetching full messages...`);

    // Step 2: Get full message content using the IDs
    const messageIdsXml = messageIds.map(id => `<MessageID>${id}</MessageID>`).join('\n    ');
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
      return { success: false, messages: [], hasMoreMessages: false, error: errorMessage };
    }

    const messages: EbayMessage[] = [];
    const messageBlocks = parseXmlArray(messagesResponse, 'Message', 'Message');
    
    for (const block of messageBlocks) {
      const message: EbayMessage = {
        messageId: parseXmlValue(block, 'MessageID') || '',
        subject: parseXmlValue(block, 'Subject') || '(No Subject)',
        body: parseXmlValue(block, 'Text') || parseXmlValue(block, 'Content') || '',
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
      const questionBlock = parseXmlValue(block, 'Question') || block;
      const message: EbayMessage = {
        messageId: parseXmlValue(questionBlock, 'MessageID') || '',
        subject: parseXmlValue(questionBlock, 'Subject') || '(No Subject)',
        body: parseXmlValue(questionBlock, 'Body') || '',
        sender: parseXmlValue(questionBlock, 'SenderID') || '',
        senderEmail: parseXmlValue(questionBlock, 'SenderEmail') || undefined,
        recipientUserId: parseXmlValue(questionBlock, 'RecipientID') || '',
        itemId: parseXmlValue(block, 'ItemID') || undefined,
        itemTitle: undefined,
        creationDate: parseXmlValue(questionBlock, 'CreationDate') || new Date().toISOString(),
        messageType: parseXmlValue(questionBlock, 'QuestionType') || 'General',
        isRead: false,
        flagged: false,
        responseEnabled: true,
      };
      messages.push(message);
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
