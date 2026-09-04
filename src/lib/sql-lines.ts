export async function* readSqlLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let fragments: string[] = [];

  for await (const chunk of chunks) {
    let start = 0;
    let end = chunk.indexOf('\n', start);
    while (end !== -1) {
      fragments.push(chunk.slice(start, end));
      yield fragments.join('');
      fragments = [];
      start = end + 1;
      end = chunk.indexOf('\n', start);
    }
    if (start < chunk.length) fragments.push(chunk.slice(start));
  }

  if (fragments.length > 0) yield fragments.join('');
}
