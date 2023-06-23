import type { Element } from 'hast';
import { splitElement } from './splitElement';
import {
  findOverlap,
  getContent,
  nextElementMaybeContinuesChars,
} from './utils';
import { hasOwnProperty } from '../utils';

export function getElementsToHighlight(
  element: Element,
  chars: string,
  startIndex = 0,
  ignoreChars = false
): Array<{ element: Element; index: number }> {
  const toWrap = [];
  let charsSoFar = '';

  if (element.children) {
    const elements = element.children as Element[];

    for (let i = startIndex; i < elements.length; i++) {
      const remaining = charsSoFar ? chars.replace(charsSoFar, '') : chars;

      if (remaining === '') {
        return toWrap;
      }

      const maybeElement = elements[i];

      if (
        !maybeElement ||
        maybeElement.type !== 'element' ||
        // ignore any previously matched words within
        hasOwnProperty(
          maybeElement.properties ?? {},
          'rehype-pretty-code-visited'
        )
      ) {
        continue;
      }

      const content = getContent(maybeElement) || '';

      // node is the word, or it finishes the word
      if (content === chars || charsSoFar + content === chars) {
        toWrap.push({ element: maybeElement, index: i });
        return toWrap;
      }

      // check if the whole node is a continuation of the word
      if (chars.startsWith(charsSoFar + content)) {
        // make sure we continue here only if further siblings
        // complete the word. Otherwise an earlier repetition
        // of a section of the word will lead us down the wrong path
        if (
          nextElementMaybeContinuesChars({
            elements,
            nextIndex: i + 1,
            remainingPart: remaining.replace(content, ''),
          })
        ) {
          toWrap.push({ element: elements[i], index: i });
          charsSoFar += content;
          continue;
        }
      }

      const overlap = findOverlap(content, remaining);
      const partialMatch = overlap && remaining.startsWith(overlap);

      if (partialMatch) {
        const nextPart = remaining.replace(overlap, '');

        // this is the wrong node, continue
        if (
          nextPart !== '' &&
          getContent(elements[i + 1]) &&
          !nextElementMaybeContinuesChars({
            elements,
            nextIndex: i + 1,
            remainingPart: nextPart,
          })
        ) {
          continue;
        }

        const splitParts = content.split(overlap);
        const [leftPart, rightPart, ...rest] = splitParts;

        if (rightPart || leftPart || rest.length > 0) {
          // One of the below scenarios should be true
          // 1. the whole word is inside the string (at least once) ca[rro]t
          // 2. the word finishes or starts & ends on the beginnning of the string ...[carr]ot
          // 3. the word starts or starts & ends from the end of the string carr[ot]...

          const withNextNode =
            content +
            (getContent(elements[i + 1]) ? getContent(elements[i + 1]) : '');
          const nextNodeOverlap = findOverlap(withNextNode, remaining);
          const splitIndex = withNextNode.indexOf(nextNodeOverlap);

          if (chars.endsWith(overlap) || chars.startsWith(overlap)) {
            const rightString = rightPart.replace(overlap, '');
            const innerString = overlap;
            const leftString = content.substring(0, splitIndex);

            // need to check this to avoid edge case where the right
            // side will be duplicated when the matched part repeats within the
            // current node
            const nextElementContinues = nextElementMaybeContinuesChars({
              elements,
              nextIndex: i + 1,
              remainingPart: nextPart,
            });

            const [newElement, updatedIndex] = splitElement({
              elements,
              elementToWrap: elements[i],
              innerString,
              rightString,
              leftString,
              rest,
              nextElementContinues,
              index: i,
              ignoreChars,
            });

            charsSoFar += overlap;

            toWrap.push({
              element: newElement,
              index: updatedIndex,
            });
          }
        }
      }
    }
  }

  return toWrap;
}
