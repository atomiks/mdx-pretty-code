import {toHast} from 'mdast-util-to-hast';
import {toHtml} from 'hast-util-to-html';
import {remark} from 'remark';
import {readdirSync, readFileSync, lstatSync} from 'fs';
import {fileURLToPath} from 'url';
import {join, parse, dirname} from 'path';
import {toMatchFile} from 'jest-file-snapshot';
import prettier from 'prettier';
import {createRemarkPlugin} from '../src';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
expect.extend({toMatchFile});

const fixturesFolder = join(__dirname, 'fixtures');
const resultsFolder = join(__dirname, 'results');

const getHTML = async (code, settings) => {
  const markdownAST = remark().parse(code);
  await createRemarkPlugin({...settings})()(markdownAST);
  const hAST = toHast(markdownAST, {allowDangerousHtml: true});
  return toHtml(hAST, {allowDangerousHtml: true});
};

// To add a test, create a markdown file in the fixtures folder
const runFixture = async (fixture, fixtureName) => {
  const resultHTMLName = parse(fixtureName).name + '.html';
  const resultHTMLPath = join(resultsFolder, resultHTMLName);

  const code = readFileSync(fixture, 'utf8');

  const html = await getHTML(code, {
    shikiOptions: {
      theme: JSON.parse(
        readFileSync(
          join(__dirname, '../node_modules/shiki/themes/github-dark.json'),
          'utf-8'
        )
      ),
    },
    onVisitHighlightedLine(node) {
      Object.assign(node.style, {
        backgroundColor: 'rgba(255, 255, 255, 0.25)',
      });
    },
    onVisitHighlightedWord(node) {
      Object.assign(node.style, {
        backgroundColor: 'rgba(255, 255, 255, 0.25)',
        padding: '1px',
        borderRadius: '3px',
      });
    },
    onVisitLine(node) {},
  });

  const htmlString = prettier.format(html, {parser: 'html'});
  return {htmlString, resultHTMLPath};
};

describe('with fixtures', () => {
  readdirSync(fixturesFolder).forEach((fixtureName) => {
    const fixture = join(fixturesFolder, fixtureName);
    if (lstatSync(fixture).isDirectory()) {
      return;
    }

    it('Fixture: ' + fixtureName, async () => {
      const {htmlString, resultHTMLPath} = await runFixture(
        fixture,
        fixtureName
      );
      expect(defaultStyle + htmlString).toMatchFile(resultHTMLPath);
    });
  });
});

const defaultStyle = `
<style>
  html {
    font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  }
  body {
    margin: 30px auto;
    max-width: 800px;
  }
  pre {
    background: black;
    display: grid;
    padding: 16px;
  }
  span > code {
    background: black;
    padding: 4px;
  }
</style>
`;
