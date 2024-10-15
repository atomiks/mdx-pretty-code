import type { Element, ElementContent, ElementData, Root } from 'hast';
import type { Options, Theme, CharsHighlighterOptions } from './types';
import {
  type Highlighter,
  type CodeToHastOptions,
  getSingletonHighlighter as defaultGetHighlighter,
} from 'shiki';
import { visit } from 'unist-util-visit';
import { toString as hastToString } from 'hast-util-to-string';
import rangeParser from 'parse-numeric-range';
import { unified, type Transformer } from 'unified';
import rehypeParse from 'rehype-parse';
import { charsHighlighter } from './chars/charsHighlighter';
import { reverseString } from './chars/utils';
import {
  isElement,
  isText,
  isJSONTheme,
  parseBlockMetaString,
  isBlockCode,
  getInlineCodeLang,
  isInlineCode,
  getThemeNames,
  replaceLineClass,
  getLineId,
} from './utils';
export type { Options, LineElement, CharsElement, Theme } from './types';

interface ApplyProps {
  tree: Root;
  lang: string;
  title?: string | null;
  caption?: string | null;
  inline?: boolean;
  keepBackground?: boolean;
  grid?: boolean;
  lineNumbersMaxDigits?: number;
  theme: Theme | Record<string, Theme>;
  onVisitTitle?(element: Element): void;
  onVisitCaption?(element: Element): void;
}

function apply(
  element: Element,
  {
    tree,
    lang,
    title,
    caption,
    inline = false,
    keepBackground = true,
    grid = true,
    lineNumbersMaxDigits = 1,
    theme,
    onVisitTitle,
    onVisitCaption,
  }: ApplyProps,
) {
  element.tagName = inline ? 'span' : 'figure';
  element.properties['data-rehype-pretty-code-figure'] = '';

  const codeData = element.children[0]?.data as ElementData | undefined;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
  element.children = [tree].flatMap((tree) => {
    const pre = tree.children[0];
    const themeNames = getThemeNames(theme);
    const themeNamesString = themeNames.join(' ');

    if (!(isElement(pre) && pre.properties)) {
      return [];
    }

    const code = pre.children[0];

    // Remove extraneous classes
    if (
      Array.isArray(pre.properties.className) &&
      pre.properties.className.includes('shiki')
    ) {
      const className = pre.properties.className.filter(
        (c) =>
          c !== 'shiki' &&
          c !== 'shiki-themes' &&
          (typeof c === 'string' ? !themeNames.includes(c) : true),
      );
      pre.properties.className = className.length > 0 ? className : undefined;
    }

    if (!keepBackground) {
      pre.properties.style = undefined;
    }

    pre.properties['data-language'] = lang;
    pre.properties['data-theme'] = themeNamesString;

    if (!(isElement(code) && code.properties)) {
      return [];
    }

    code.properties['data-language'] = lang;
    code.properties['data-theme'] = themeNamesString;
    code.data = codeData;

    if (inline) {
      if (keepBackground) {
        code.properties.style = pre.properties.style;
      }
      return code;
    }

    if (grid) {
      if (code.properties.style) {
        code.properties.style += 'display: grid;';
      } else {
        code.properties.style = 'display: grid;';
      }
    }

    if (Object.hasOwn(code.properties, 'data-line-numbers')) {
      code.properties['data-line-numbers-max-digits'] =
        lineNumbersMaxDigits.toString().length;
    }

    const fragments: Array<ElementContent> = [];

    if (title) {
      const elementContent: Element = {
        type: 'element',
        tagName: caption ? 'div' : 'figcaption',
        properties: {
          'data-rehype-pretty-code-title': '',
          'data-language': lang,
          'data-theme': themeNamesString,
        },
        children: [{ type: 'text', value: title }],
      };
      onVisitTitle?.(elementContent);
      fragments.push(elementContent);
    }

    fragments.push(pre);

    if (caption) {
      const elementContent: Element = {
        type: 'element',
        tagName: 'figcaption',
        properties: {
          'data-rehype-pretty-code-caption': '',
          'data-language': lang,
          'data-theme': themeNamesString,
        },
        children: [{ type: 'text', value: caption }],
      };
      onVisitCaption?.(elementContent);
      fragments.push(elementContent);
    }

    return fragments;
  });
}

const globalHighlighterCache = new Map<string, Promise<Highlighter>>();
const hastParser = unified().use(rehypeParse, { fragment: true });

export default rehypePrettyCode;

export function rehypePrettyCode(
  options: Options = {},
): void | Transformer<Root, Root> {
  const {
    grid = true,
    theme = 'github-dark-dimmed',
    keepBackground = true,
    bypassInlineCode = false,
    defaultLang = '',
    tokensMap = {},
    filterMetaString = (v) => v,
    getHighlighter = defaultGetHighlighter,
    transformers,
    onVisitLine,
    onVisitHighlightedLine,
    onVisitHighlightedChars,
    onVisitTitle,
    onVisitCaption,
  } = options;

  const key = JSON.stringify(theme);

  let cachedHighlighter = globalHighlighterCache.get(key);
  if (!cachedHighlighter) {
    cachedHighlighter = getHighlighter({
      themes:
        isJSONTheme(theme) || typeof theme === 'string'
          ? [theme]
          : Object.values(theme),
      langs: ['plaintext'],
    });
    globalHighlighterCache.set(key, cachedHighlighter);
  }

  const defaultCodeBlockLang =
    typeof defaultLang === 'string' ? defaultLang : defaultLang.block || '';
  const defaultInlineCodeLang =
    typeof defaultLang === 'string' ? defaultLang : defaultLang.inline || '';

  function getOptions(
    lang: string,
    meta?: string,
  ): CodeToHastOptions<string, string> {
    const multipleThemes =
      !isJSONTheme(theme) && typeof theme === 'object' ? theme : null;
    const singleTheme =
      isJSONTheme(theme) || typeof theme === 'string' ? theme : null;

    return {
      lang,
      meta: { __raw: meta },
      transformers,
      defaultColor: typeof theme === 'string' ? theme : false,
      ...(multipleThemes
        ? { themes: multipleThemes }
        : { theme: singleTheme as Theme }),
    };
  }

  return async (tree) => {
    const langsToLoad = new Set<string>();
    const highlighter = await cachedHighlighter;
    if (!highlighter) return;

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
    visit(tree, 'element', (element, _, parent) => {
      if (isInlineCode(element, parent, bypassInlineCode)) {
        const textElement = element.children[0];
        if (!isText(textElement)) return;
        const value = textElement.value;
        if (!value) return;
        const lang = getInlineCodeLang(value, defaultInlineCodeLang);
        if (lang && lang[0] !== '.') {
          langsToLoad.add(lang);
        }
      }

      if (isBlockCode(element)) {
        const codeElement = element.children[0];
        if (!isElement(codeElement)) return;

        const { lang } = parseBlockMetaString(
          codeElement,
          filterMetaString,
          defaultCodeBlockLang,
        );

        if (lang) {
          langsToLoad.add(lang);
        }
      }
    });

    try {
      await Promise.allSettled(
        Array.from(langsToLoad).map((lang) => {
          try {
            return highlighter.loadLanguage(
              lang as Parameters<typeof highlighter.loadLanguage>[0],
            );
          } catch (e) {
            return Promise.reject(e);
          }
        }),
      );
    } catch (e) {
      console.error(e);
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
    visit(tree, 'element', (element, _, parent) => {
      if (isInlineCode(element, parent, bypassInlineCode)) {
        const textElement = element.children[0];
        if (!isText(textElement)) return;
        const value = textElement.value;
        if (!value) return;

        const keepLangPart = /\\{:[a-zA-Z.-]+}$/.test(value);
        const strippedValue = keepLangPart
          ? value.replace(/\\({:[a-zA-Z.-]+})$/, '$1')
          : value.replace(/{:[a-zA-Z.-]+}$/, '');
        textElement.value = strippedValue;
        const lang = keepLangPart
          ? ''
          : getInlineCodeLang(value, defaultInlineCodeLang);
        const isLang = lang[0] !== '.';
        if (!lang) return;

        let codeTree: Root;

        if (isLang) {
          try {
            codeTree = hastParser.parse(
              highlighter.codeToHtml(strippedValue, getOptions(lang)),
            );
          } catch {
            codeTree = hastParser.parse(
              highlighter.codeToHtml(strippedValue, getOptions('plaintext')),
            );
          }
        } else {
          const themeNames = getThemeNames(theme);
          const isMultiTheme = typeof theme === 'object' && !isJSONTheme(theme);
          const themeKeys = isMultiTheme ? Object.keys(theme) : null;
          const colorsByTheme = themeNames.map((name) =>
            name
              ? highlighter
                  .getTheme(name)
                  .settings.find(({ scope }) =>
                    scope?.includes(tokensMap[lang.slice(1)] ?? lang.slice(1)),
                  )?.settings.foreground ?? 'inherit'
              : 'inherit',
          );

          if (isMultiTheme && themeKeys) {
            codeTree = hastParser.parse(
              `<pre><code><span style="${themeKeys
                .map((key, i) => `--shiki-${key}:${colorsByTheme[i]}`)
                .join(';')}">${strippedValue}</span></code></pre>`,
            );
          } else {
            codeTree = hastParser.parse(
              `<pre><code><span style="color:${colorsByTheme[0]}">${strippedValue}</span></code></pre>`,
            );
          }
        }

        visit(codeTree, 'element', replaceLineClass);

        apply(element, {
          tree: codeTree,
          lang: isLang ? lang : '.token',
          inline: true,
          keepBackground,
          theme,
        });
      }

      if (isBlockCode(element)) {
        const codeElement = element.children[0];
        if (!isElement(codeElement)) return;
        const textElement = codeElement.children[0];

        const { title, caption, meta, lang } = parseBlockMetaString(
          codeElement,
          filterMetaString,
          defaultCodeBlockLang,
        );

        if (!lang || lang === 'math') return;

        const lineNumbers: Array<number> = [];
        if (meta) {
          const matches = meta.matchAll(/\B\{(.*?)\}\B/g);
          for (const match of matches) {
            if (match[1]) {
              lineNumbers.push(...rangeParser(match[1]));
            }
          }
        }

        let lineNumbersMaxDigits = 0;
        const lineIdMap = new Map<number, string>();
        const charsList: Array<string> = [];
        const charsListNumbers: Array<Array<number>> = [];
        const charsListIdMap = new Map();
        const charsMatches = meta
          ? [
              ...meta.matchAll(
                /(?<delimiter>["/])(?<chars>.*?)\k<delimiter>(?<charsIdAndOrRange>\S*)/g,
              ),
            ]
          : undefined;

        lineNumbers.forEach((lineNumber) => {
          const id = getLineId(lineNumber, meta);
          id && lineIdMap.set(lineNumber, id);
        });

        if (Array.isArray(charsMatches)) {
          charsMatches.forEach((name) => {
            const { chars, charsIdAndOrRange } = name.groups as {
              chars: string;
              charsIdAndOrRange: string;
            };
            charsList.push(chars);
            if (charsIdAndOrRange === '') {
              charsListNumbers.push([]);
            } else {
              const [range, id] = charsIdAndOrRange.split('#');
              range && charsListNumbers.push(rangeParser(range));
              id && charsListIdMap.set(chars, id);
            }
          });
        }

        if (!isText(textElement)) return;

        const strippedValue = textElement.value.replace(/\n$/, '');
        let codeTree: Root;

        try {
          codeTree = hastParser.parse(
            highlighter.codeToHtml(strippedValue, getOptions(lang, meta)),
          );
        } catch {
          codeTree = hastParser.parse(
            highlighter.codeToHtml(
              strippedValue,
              getOptions('plaintext', meta),
            ),
          );
        }

        let lineCounter = 0;

        const charsHighlighterOptions: CharsHighlighterOptions = {
          ranges: charsListNumbers,
          idsMap: charsListIdMap,
          counterMap: new Map<string, number>(),
        };

        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
        visit(codeTree, 'element', (element) => {
          if (
            element.tagName === 'code' &&
            /srebmuNeniLwohs(?!(.*)(\/))/.test(reverseString(meta))
          ) {
            if (element.properties) {
              element.properties['data-line-numbers'] = '';
            }

            const lineNumbersStartAtMatch = reverseString(meta).match(
              /(?:\}(\d+){)?srebmuNeniLwohs(?!(.*)(\/))/,
            );
            const startNumberString = lineNumbersStartAtMatch?.[1];
            if (startNumberString) {
              const startAt = startNumberString
                ? Number(reverseString(startNumberString)) - 1
                : 0;
              lineNumbersMaxDigits = startAt;
              if (element.properties) {
                element.properties.style = `counter-set: line ${startAt};`;
              }
            }
          }

          if (
            Array.isArray(element.properties?.className) &&
            element.properties?.className?.[0] === 'line'
          ) {
            if (grid && hastToString(element) === '') {
              element.children = [{ type: 'text', value: ' ' }];
            }

            replaceLineClass(element);
            onVisitLine?.(element);

            lineCounter++;

            if (lineNumbers.includes(lineCounter)) {
              element.properties['data-highlighted-line'] = '';

              const lineId = lineIdMap.get(lineCounter);
              if (lineId) {
                element.properties['data-highlighted-line-id'] = lineId;
              }

              onVisitHighlightedLine?.(element, lineId);
            }

            charsHighlighter(
              element,
              charsList,
              charsHighlighterOptions,
              onVisitHighlightedChars,
            );

            lineNumbersMaxDigits++;
          }
        });

        apply(element, {
          tree: codeTree,
          lang,
          title,
          caption,
          keepBackground,
          grid,
          lineNumbersMaxDigits,
          theme,
          onVisitTitle,
          onVisitCaption,
        });
      }
    });
  };
}
