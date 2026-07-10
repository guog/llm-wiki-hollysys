import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export async function splitLargeDocument(text: string): Promise<string[]> {
  const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
    chunkSize: 12_000,
    chunkOverlap: 1_000,
  });
  return splitter.splitText(text);
}
