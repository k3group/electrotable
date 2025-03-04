/* global document */

import Selector from './selector';
import Scroll from './scroll';
import History from './history';
import Clipboard from './clipboard';
import AutoFilter from './auto_filter';
import { Merges } from './merge';
import helper from './helper';
import { Rows } from './row';
import { Cols } from './col';
import { Validations } from './validation';
import { CellRange } from './cell_range';
import { expr2xy, xy2expr } from './alphabet';
import { t } from '../locale/locale';
import { formatm } from './format';

// private methods
/*
 * {
 *  name: ''
 *  freeze: [0, 0],
 *  formats: [],
 *  styles: [
 *    {
 *      bgcolor: '',
 *      align: '',
 *      valign: '',
 *      textwrap: false,
 *      strike: false,
 *      underline: false,
 *      color: '',
 *      format: 1,
 *      border: {
 *        left: [style, color],
 *        right: [style, color],
 *        top: [style, color],
 *        bottom: [style, color],
 *      },
 *      font: {
 *        name: 'Helvetica',
 *        size: 10,
 *        bold: false,
 *        italic: false,
 *      }
 *    }
 *  ],
 *  merges: [
 *    'A1:F11',
 *    ...
 *  ],
 *  rows: {
 *    1: {
 *      height: 50,
 *      style: 1,
 *      cells: {
 *        1: {
 *          style: 2,
 *          type: 'string',
 *          text: '',
 *          value: '', // cal result
 *        }
 *      }
 *    },
 *    ...
 *  },
 *  cols: {
 *    2: { width: 100, style: 1 }
 *  }
 * }
 */
const defaultSettings = {
  mode: 'edit', // edit | read
  view: {
    height: () => document.documentElement.clientHeight,
    width: () => document.documentElement.clientWidth,
  },
  showGrid: true,
  showToolbar: true,
  showContextmenu: true,
  showBottomBar: true,
  row: {
    len: 100,
    height: 25,
  },
  col: {
    len: 26,
    width: 100,
    indexWidth: 60,
    minWidth: 60,
  },
  style: {
    bgcolor: '#ffffff',
    align: 'left',
    valign: 'middle',
    textwrap: false,
    strike: false,
    underline: false,
    color: '#0a0a0a',
    font: {
      name: 'Arial',
      size: 10,
      bold: false,
      italic: false,
    },
    format: 'normal',
  },
};

const toolbarHeight = 41;
const bottombarHeight = 41;

// src: cellRange
// dst: cellRange
function canPaste(src, dst, error = () => {}) {
  const { merges } = this;
  const cellRange = dst.clone();
  const [srn, scn] = src.size();
  const [drn, dcn] = dst.size();
  if (srn > drn) {
    cellRange.eri = dst.sri + srn - 1;
  }
  if (scn > dcn) {
    cellRange.eci = dst.sci + scn - 1;
  }
  if (merges.intersects(cellRange)) {
    error(t('error.pasteForMergedCell'));
    return false;
  }
  return true;
}
function copyPaste(srcCellRange, dstCellRange, what, autofill = false, dataSet = []) {
  const { rows, merges, sortedRowMap } = this;
  // delete dest merge
  if (what === 'all' || what === 'format') {
    merges.deleteWithin(dstCellRange);
  }
  let changedMerges = false;
  const changedRows = rows.copyPaste(
    srcCellRange, dstCellRange, what, sortedRowMap, autofill, dataSet,
    (ri, ci, cell) => {
      if (cell && cell.merge) {
        // console.log('cell:', ri, ci, cell);
        const [rn, cn] = cell.merge;
        if (rn <= 0 && cn <= 0) return;
        merges.add(new CellRange(ri, ci, ri + rn, ci + cn));
        changedMerges = true;
      }
    },
  );
  return ({
    ...changedRows,
    ...(changedMerges ? { merges: merges.getData() } : {}),
  });
}

function cutPaste(srcCellRange, dstCellRange) {
  // console.trace();
  const {
    clipboard, rows, merges, sortedRowMap,
  } = this;
  const changedRows = rows.cutPaste(srcCellRange, dstCellRange, sortedRowMap);
  const moved = merges.move(
    srcCellRange,
    dstCellRange.sri - srcCellRange.sri,
    dstCellRange.sci - srcCellRange.sci,
  );
  setTimeout(() => {
    clipboard.clear();
  }, 1);
  return ({
    ...changedRows,
    ...(moved ? { merges: merges.getData() } : {}),
  });
}

// bss: { top, bottom, left, right }
function setStyleBorder(ri, ci, bss) {
  const { styles, rows } = this;
  const cell = rows.getCellOrNew(ri, ci);
  let cstyle = {};
  if (cell.style !== undefined) {
    cstyle = helper.cloneDeep(styles[cell.style]);
  }
  cstyle = helper.merge(cstyle, { border: bss });
  cell.style = this.addStyle(cstyle);
}

function setStyleBorders({ mode, style, color }) {
  const { styles, selector, rows } = this;
  const {
    sri, sci, eri, eci,
  } = selector.range;
  const multiple = !this.isSingleSelected();
  if (!multiple) {
    if (mode === 'inside' || mode === 'horizontal' || mode === 'vertical') {
      return null;
    }
  }
  const changedCells = [];
  if (mode === 'outside' && !multiple) {
    setStyleBorder.call(this, sri, sci, {
      top: [style, color], bottom: [style, color], left: [style, color], right: [style, color],
    });
  } else if (mode === 'none') {
    selector.range.each((ri, ci) => {
      const cell = rows.getCell(ri, ci);
      if (cell && cell.style !== undefined) {
        const ns = helper.cloneDeep(styles[cell.style]);
        delete ns.border;
        // ['bottom', 'top', 'left', 'right'].forEach((prop) => {
        //   if (ns[prop]) delete ns[prop];
        // });
        cell.style = this.addStyle(ns);
        changedCells.push({ ri, ci, cell });
      }
    });
  } else if (mode === 'all' || mode === 'inside' || mode === 'outside'
    || mode === 'horizontal' || mode === 'vertical') {
    const merges = [];
    for (let ri = sri; ri <= eri; ri += 1) {
      for (let ci = sci; ci <= eci; ci += 1) {
        // jump merges -- start
        const mergeIndexes = [];
        for (let ii = 0; ii < merges.length; ii += 1) {
          const [mri, mci, rn, cn] = merges[ii];
          if (ri === mri + rn + 1) mergeIndexes.push(ii);
          if (mri <= ri && ri <= mri + rn) {
            if (ci === mci) {
              ci += cn + 1;
              break;
            }
          }
        }
        mergeIndexes.forEach(it => merges.splice(it, 1));
        if (ci > eci) break;
        // jump merges -- end
        const cell = rows.getCell(ri, ci);
        let [rn, cn] = [0, 0];
        if (cell && cell.merge) {
          [rn, cn] = cell.merge;
          merges.push([ri, ci, rn, cn]);
        }
        const mrl = rn > 0 && ri + rn === eri;
        const mcl = cn > 0 && ci + cn === eci;
        let bss = {};
        if (mode === 'all') {
          bss = {
            bottom: [style, color],
            top: [style, color],
            left: [style, color],
            right: [style, color],
          };
        } else if (mode === 'inside') {
          if (!mcl && ci < eci) bss.right = [style, color];
          if (!mrl && ri < eri) bss.bottom = [style, color];
        } else if (mode === 'horizontal') {
          if (!mrl && ri < eri) bss.bottom = [style, color];
        } else if (mode === 'vertical') {
          if (!mcl && ci < eci) bss.right = [style, color];
        } else if (mode === 'outside' && multiple) {
          if (sri === ri) bss.top = [style, color];
          if (mrl || eri === ri) bss.bottom = [style, color];
          if (sci === ci) bss.left = [style, color];
          if (mcl || eci === ci) bss.right = [style, color];
        }
        if (Object.keys(bss).length > 0) {
          setStyleBorder.call(this, ri, ci, bss);
          changedCells.push({ ri, ci, cell });
        }
        ci += cn;
      }
    }
  } else if (mode === 'top' || mode === 'bottom') {
    for (let ci = sci; ci <= eci; ci += 1) {
      if (mode === 'top') {
        setStyleBorder.call(this, sri, ci, { top: [style, color] });
        ci += rows.getCellMerge(sri, ci)[1];
      }
      if (mode === 'bottom') {
        setStyleBorder.call(this, eri, ci, { bottom: [style, color] });
        ci += rows.getCellMerge(eri, ci)[1];
      }
      changedCells.push({ ri: sri, ci, cell: rows.getCell(sri, ci) });
    }
  } else if (mode === 'left' || mode === 'right') {
    for (let ri = sri; ri <= eri; ri += 1) {
      if (mode === 'left') {
        setStyleBorder.call(this, ri, sci, { left: [style, color] });
        ri += rows.getCellMerge(ri, sci)[0];
      }
      if (mode === 'right') {
        setStyleBorder.call(this, ri, eci, { right: [style, color] });
        ri += rows.getCellMerge(ri, eci)[0];
      }
      changedCells.push({ ri, ci: eci, cell: rows.getCell(ri, eci) });
    }
  }
  return ([
    {
      ...Rows.reduceAsRows(changedCells, this.rows.len),
      styles,
    },
    selector.rangeObject,
  ]);
}

function getCellRowByY(y, scrollOffsety) {
  const { rows } = this;
  const fsh = this.freezeTotalHeight();
  // console.log('y:', y, ', fsh:', fsh);
  let inits = rows.height;
  if (fsh + rows.height < y) inits -= scrollOffsety;

  // handle ri in autofilter
  const frset = this.exceptRowSet;

  let ri = 0;
  let top = inits;
  let { height } = rows;
  for (; ri < rows.len; ri += 1) {
    if (top > y) break;
    if (!frset.has(ri)) {
      height = rows.getHeight(ri);
      top += height;
    }
  }
  top -= height;
  // console.log('ri:', ri, ', top:', top, ', height:', height);

  if (top <= 0) {
    return { ri: -1, top: 0, height };
  }

  return { ri: ri - 1, top, height };
}

function getCellColByX(x, scrollOffsetx) {
  const { cols } = this;
  const fsw = this.freezeTotalWidth();
  let inits = cols.indexWidth;
  if (fsw + cols.indexWidth < x) inits -= scrollOffsetx;
  const [ci, left, width] = helper.rangeReduceIf(
    0,
    cols.len,
    inits,
    cols.indexWidth,
    x,
    i => cols.getWidth(i),
  );
  if (left <= 0) {
    return { ci: -1, left: 0, width: cols.indexWidth };
  }
  return { ci: ci - 1, left, width };
}

export default class DataProxy {
  constructor(name, settings) {
    this.settings = helper.merge(defaultSettings, settings || {});
    // save data begin
    this.name = name || 'sheet';
    this.freeze = [0, 0];
    this.styles = []; // Array<Style>
    this.merges = new Merges(); // [CellRange, ...]
    this.rows = new Rows(this.settings.row);
    this.cols = new Cols(this.settings.col);
    this.validations = new Validations();
    this.hyperlinks = {};
    this.comments = {};
    // save data end

    // don't save object
    this.selector = new Selector();
    this.scroll = new Scroll();
    this.history = new History();
    this.history.init({
      rows: { len: this.rows.len },
      cols: { len: this.cols.len },
    });
    this.clipboard = new Clipboard();
    this.autoFilter = new AutoFilter();
    this.change = () => {};
    this.exceptRowSet = new Set();
    this.sortedRowMap = new Map();
    this.setRowMap();
  }

  addValidation(mode, ref, validator) {
    // console.log('mode:', mode, ', ref:', ref, ', validator:', validator);
    this.changeData(() => {
      this.validations.add(mode, ref, validator);
      return ([
        {
          validations: this.validations.getData(),
        },
        this.selector.rangeObject,
      ]);
    });
  }

  removeValidation() {
    const { range } = this.selector;
    this.changeData(() => {
      this.validations.remove(range);
      return ([
        {
          validations: this.validations.getData(),
        },
        this.selector.rangeObject,
      ]);
    });
  }

  getSelectedValidator() {
    const { ri, ci } = this.selector;
    const v = this.validations.get(ri, ci);
    return v ? v.validator : null;
  }

  getSelectedValidation() {
    const { ri, ci, range } = this.selector;
    const v = this.validations.get(ri, ci);
    const ret = { ref: range.toString() };
    if (v !== null) {
      ret.mode = v.mode;
      ret.validator = v.validator;
    }
    return ret;
  }

  canUndo() {
    return this.history.canUndo();
  }

  canRedo() {
    return this.history.canRedo();
  }

  undo(cb) {
    this.history.undo(([d, s]) => {
      if (Object.keys(d).length > 0) {
        this.setData(d);
        // TODO save exceptRowSet, sortedRowMap in history
        // remove applied filters due to constraints in the history
        this.autoFilter.filters = [];
        this.exceptRowSet = new Set();
        this.sortedRowMap = new Map();
      }
      if (cb) {
        cb(s);
      }
    });
  }

  redo(cb) {
    this.history.redo(([d, s]) => {
      if (Object.keys(d).length > 0) {
        this.setData(d);
        // remove applied filters due to constraints in the history
        this.autoFilter.filters = [];
        this.exceptRowSet = new Set();
        this.sortedRowMap = new Map();
      }
      if (cb) {
        cb(s);
      }
    });
  }

  getCellsGroupedByRow() {
    const { rows, cols } = this;
    const colData = cols.getData();
    const allRows = [];
    rows.each((ri) => {
      const row = { ri: parseInt(ri, 10), cells: [] };
      rows.eachCells(ri, (ci, cell) => {
        const format = colData[ci] && colData[ci].style && colData[ci].style.format;
        if (cell.text) {
          row.cells.push({
            ci: parseInt(ci, 10),
            value: cell.text,
            ...(format ? { format } : {}),
          });
        }
      });
      allRows.push(row);
    });
    return allRows;
  }

  copy() {
    this.clipboard.copy(this.selector.range);
  }

  copyToSystemClipboard(evt) {
    let copyText = [];
    const {
      sri, eri, sci, eci,
    } = this.selector.range;

    for (let ri = sri; ri <= eri; ri += 1) {
      const row = [];
      for (let ci = sci; ci <= eci; ci += 1) {
        const { text } = this.getCell(ri, ci) || {};
        row.push(text === 0 ? 0 : text || '');
      }
      copyText.push(row);
    }

    // Adding \n and why not adding \r\n is to support online office and client MS office and WPS
    copyText = copyText.map(row => row.join('\t')).join('\n');

    // why used this
    // cuz http protocol will be blocked request clipboard by browser
    if (evt) {
      evt.clipboardData.clearData();
      evt.clipboardData.setData('text/plain', copyText);
      evt.preventDefault();
    }

    // this need https protocol
    /* global navigator */
    if (navigator.clipboard) {
      navigator.clipboard.writeText(copyText).then(() => {}, (err) => {
        console.log('text copy to the system clipboard error  ', copyText, err);
      });
    }
  }

  cut() {
    this.clipboard.cut(this.selector.range);
  }

  // what: all | text | format
  paste(what = 'all', dataSet = [], error = () => {}) {
    // console.log('sIndexes:', sIndexes);
    const {
      clipboard, selector, rows, cols,
    } = this;
    if (clipboard.isClear()) return false;
    const {
      eri: ceri, sri: csri, eci: ceci, sci: csci,
    } = clipboard.range;
    const { sri, sci } = selector.range;
    const clipboardRowsLen = ceri - csri + 1;
    const rowsDiff = rows.len - sri;
    const clipboardColsLen = ceci - csci + 1;
    const colsDiff = cols.len - sci;
    let colInserted = false;
    if (rowsDiff < clipboardRowsLen) {
      this.insert('row', clipboardRowsLen - rowsDiff, false, () => null);
    }
    if (colsDiff < clipboardColsLen) {
      this.insert('column', clipboardColsLen - colsDiff, false, () => null);
      colInserted = true;
    }
    if (!canPaste.call(this, clipboard.range, selector.range, error)) return false;

    this.changeData(() => {
      let res;
      if (clipboard.isCopy()) {
        res = copyPaste.call(this, clipboard.range, selector.range, what, false, dataSet);
      } else if (clipboard.isCut()) {
        res = cutPaste.call(this, clipboard.range, selector.range);
      }
      return [
        {
          ...res,
          ...(colInserted ? { cols: { len: this.cols.len } } : {}),
        },
        {
          sri: selector.range.sri,
          sci: selector.range.sci,
          eri: selector.range.sri + (clipboard.range.eri - clipboard.range.sri),
          eci: selector.range.sci + (clipboard.range.eci - clipboard.range.sci),
        },
      ];
    });
    return true;
  }

  pasteFromText(lines) {
    if (lines.length) {
      const {
        rows, selector, cols, sortedRowMap,
      } = this;
      const { sri, sci } = selector.range;
      const rowsDiff = rows.len - sri;
      const colsDiff = cols.len - sci;
      let colInserted = false;

      if (rowsDiff < lines.length) {
        this.insert('row', lines.length - rowsDiff, false, () => null);
      }

      if (colsDiff < lines[0].length) {
        this.insert('column', lines[0].length - colsDiff, false, () => null);
        colInserted = true;
      }

      this.changeData(() => [
        {
          ...rows.paste(lines, selector.range, sortedRowMap),
          ...(colInserted ? { cols: { len: this.cols.len } } : {}),
        },
        {
          sri: selector.range.sri,
          sci: selector.range.sci,
          eri: selector.range.sri + (lines.length - 1),
          eci: selector.range.sci + (lines[0].length - 1),
        },
      ]);
    }
    const [first] = lines;
    return { rlen: lines.length - 1, clen: first.length - 1 };
  }

  autofill(dpSelector, what, error = () => {}) {
    // console.trace();
    const { range } = this.selector;
    if (!canPaste.call(this, range, dpSelector.arange, error)) return false;
    this.changeData(() => {
      const {
        sri: srcSri, sci: srcSci, eri: srcEri, eci: srcEci,
      } = range;
      const {
        sri: destSri, sci: destSci, eri: destEri, eci: destEci,
      } = dpSelector.arange;

      let sci = srcEci;
      let eci = destSci;
      if (srcSci <= destEci) {
        sci = srcSci;
        eci = destEci;
      }

      let sri = srcEri;
      let eri = destSri;
      if (srcSri <= destEri) {
        sri = srcSri;
        eri = destEri;
      }

      dpSelector.setStartEnd(sri, sci, eri, eci);

      return ([
        copyPaste.call(this, range, dpSelector.arange, what, true),
        this.selector.rangeObject,
      ]);
    });
    return true;
  }

  clearClipboard() {
    this.clipboard.clear();
  }

  calSelectedRangeByEnd(ri, ci) {
    const {
      selector, rows, cols, merges,
    } = this;
    let {
      sri, sci, eri, eci,
    } = selector.range;
    const cri = selector.ri;
    const cci = selector.ci;
    let [nri, nci] = [ri, ci];
    if (ri < 0) nri = rows.len - 1;
    if (ci < 0) nci = cols.len - 1;
    if (nri > cri) [sri, eri] = [cri, nri];
    else [sri, eri] = [nri, cri];
    if (nci > cci) [sci, eci] = [cci, nci];
    else [sci, eci] = [nci, cci];
    selector.range = merges.union(new CellRange(
      sri, sci, eri, eci,
    ));
    selector.range = merges.union(selector.range);
    // console.log('selector.range:', selector.range);
    return selector.range;
  }

  calSelectedRangeByStart(ri, ci) {
    const {
      selector, rows, cols, merges,
    } = this;
    let cellRange = merges.getFirstIncludes(ri, ci);
    // console.log('cellRange:', cellRange, ri, ci, merges);
    if (cellRange === null) {
      cellRange = new CellRange(ri, ci, ri, ci);
      if (ri === -1) {
        cellRange.sri = 0;
        cellRange.eri = rows.len - 1;
      }
      if (ci === -1) {
        cellRange.sci = 0;
        cellRange.eci = cols.len - 1;
      }
    }
    selector.range = cellRange;
    return cellRange;
  }

  updateSelectedCellsInHistory() {
    const { selector, rows, history } = this;
    selector.range.each((ri, ci) => {
      setTimeout(() => {
        const { text } = rows.getCell(ri, ci);
        history.updateUndoItemCellText(ri, ci, text);
      }, 1);
    });
  }

  setSelectedCellAttr(property, value) {
    this.changeData(() => {
      const { selector, styles, rows } = this;
      const stylesLengthBeforeChanges = styles.length;
      if (property === 'merge') {
        if (value) return this.merge();
        return this.unmerge();
      }
      if (property === 'border') {
        return setStyleBorders.call(this, value);
      }
      if (property === 'formula') {
        // console.log('>>>', selector.multiple());
        const { ri, ci, range } = selector;
        if (selector.multiple()) {
          const [rn, cn] = selector.size();
          const {
            sri, sci, eri, eci,
          } = range;
          if (rn > 1) {
            for (let i = sci; i <= eci; i += 1) {
              const cell = rows.getCellOrNew(eri + 1, i);
              cell.text = `=${value}(${xy2expr(i, sri)}:${xy2expr(i, eri)})`;
            }
          } else if (cn > 1) {
            const cell = rows.getCellOrNew(ri, eci + 1);
            cell.text = `=${value}(${xy2expr(sci, ri)}:${xy2expr(eci, ri)})`;
          }
        } else {
          const cell = rows.getCellOrNew(ri, ci);
          cell.text = `=${value}()`;
        }
      } else {
        selector.range.each((ri, ci) => {
          const cell = rows.getCellOrNew(ri, ci);
          let cstyle = {};
          if (cell.style !== undefined) {
            cstyle = helper.cloneDeep(styles[cell.style]);
          }
          if (property === 'format') {
            cstyle.format = value;
            cell.style = this.addStyle(cstyle);
          } else if (property === 'font-bold' || property === 'font-italic'
            || property === 'font-name' || property === 'font-size') {
            const nfont = {};
            nfont[property.split('-')[1]] = value;
            cstyle.font = Object.assign(cstyle.font || {}, nfont);
            cell.style = this.addStyle(cstyle);
          } else if (property === 'strike' || property === 'textwrap'
            || property === 'underline'
            || property === 'align' || property === 'valign'
            || property === 'color' || property === 'bgcolor') {
            cstyle[property] = value;
            cell.style = this.addStyle(cstyle);
          } else {
            cell[property] = value;
          }
        });
      }
      const changedCells = [];
      selector.range.each((ri, ci) => {
        const cell = rows.getCellOrNew(ri, ci);
        changedCells.push({ ri, ci, cell });
      });
      return [
        {
          ...Rows.reduceAsRows(changedCells),
          ...(stylesLengthBeforeChanges !== styles.length ? { styles } : {}),
        },
        selector.rangeObject,
      ];
    });
  }

  // state: input | finished
  setSelectedCellText(text, state = 'input') {
    const { autoFilter, selector, rows } = this;
    const { ri, ci } = selector;
    let nri = ri;
    if (this.sortedRowMap.has(ri)) {
      nri = this.sortedRowMap.get(ri);
    }
    const { text: txt } = rows.getCell(nri, ci);
    const oldText = txt === null ? '' : txt;
    this.setCellText(nri, ci, text, state);
    // replace filter.value
    if (autoFilter.active()) {
      const filter = autoFilter.getFilter(ci);
      if (filter) {
        const vIndex = filter.value.findIndex(v => v === oldText);
        if (vIndex >= 0) {
          filter.value.splice(vIndex, 1, text);
        }
        // console.log('filter:', filter, oldCell);
      }
    }
    // this.resetAutoFilter();
  }

  getSelectedCell() {
    const { ri, ci } = this.selector;
    let nri = ri;
    if (this.sortedRowMap.has(ri)) {
      nri = this.sortedRowMap.get(ri);
    }
    return this.rows.getCell(nri, ci);
  }

  xyInSelectedRect(x, y) {
    const {
      left, top, width, height,
    } = this.getSelectedRect();
    const x1 = x - this.cols.indexWidth;
    const y1 = y - this.rows.height;
    // console.log('x:', x, ',y:', y, 'left:', left, 'top:', top);
    return x1 > left && x1 < (left + width)
      && y1 > top && y1 < (top + height);
  }

  getSelectedRect() {
    return this.getRect(this.selector.range);
  }

  getClipboardRect() {
    const { clipboard } = this;
    if (!clipboard.isClear()) {
      return this.getRect(clipboard.range);
    }
    return { left: -100, top: -100 };
  }

  getRect(cellRange) {
    const {
      scroll, rows, cols, exceptRowSet,
    } = this;
    const {
      sri, sci, eri, eci,
    } = cellRange;
    // console.log('sri:', sri, ',sci:', sci, ', eri:', eri, ', eci:', eci);
    // no selector
    if (sri < 0 && sci < 0) {
      return {
        left: 0, l: 0, top: 0, t: 0, scroll,
      };
    }
    const left = cols.sumWidth(0, sci);
    const top = rows.sumHeight(0, sri, exceptRowSet);
    const height = rows.sumHeight(sri, eri + 1, exceptRowSet);
    const width = cols.sumWidth(sci, eci + 1);
    // console.log('sri:', sri, ', sci:', sci, ', eri:', eri, ', eci:', eci);
    let left0 = left - scroll.x;
    let top0 = top - scroll.y;
    const fsh = this.freezeTotalHeight();
    const fsw = this.freezeTotalWidth();
    if (fsw > 0 && fsw > left) {
      left0 = left;
    }
    if (fsh > 0 && fsh > top) {
      top0 = top;
    }
    return {
      l: left,
      t: top,
      left: left0,
      top: top0,
      height,
      width,
      scroll,
    };
  }

  getCellRectByXY(x, y) {
    const {
      scroll, merges, rows, cols,
    } = this;
    let { ri, top, height } = getCellRowByY.call(this, y, scroll.y);
    let { ci, left, width } = getCellColByX.call(this, x, scroll.x);
    if (ci === -1) {
      width = cols.totalWidth();
    }
    if (ri === -1) {
      height = rows.totalHeight();
    }
    if (ri >= 0 || ci >= 0) {
      const merge = merges.getFirstIncludes(ri, ci);
      if (merge) {
        ri = merge.sri;
        ci = merge.sci;
        ({
          left, top, width, height,
        } = this.cellRect(ri, ci));
      }
    }
    return {
      ri, ci, left, top, width, height,
    };
  }

  isSingleSelected() {
    const {
      sri, sci, eri, eci,
    } = this.selector.range;
    const cell = this.getCell(sri, sci);
    if (cell && cell.merge) {
      const [rn, cn] = cell.merge;
      if (sri + rn === eri && sci + cn === eci) return true;
    }
    return !this.selector.multiple();
  }

  canUnmerge() {
    const {
      sri, sci, eri, eci,
    } = this.selector.range;
    const cell = this.getCell(sri, sci);
    if (cell && cell.merge) {
      const [rn, cn] = cell.merge;
      if (sri + rn === eri && sci + cn === eci) return true;
    }
    return false;
  }

  merge() {
    const {
      selector, rows, merges, sortedRowMap,
    } = this;
    if (this.isSingleSelected()) return null;
    const [rn, cn] = selector.size();
    // console.log('merge:', rn, cn);
    if (rn > 1 || cn > 1) {
      const { sri, sci } = selector.range;
      const cell = rows.getCellOrNew(sri, sci);
      cell.merge = [rn - 1, cn - 1];
      merges.add(selector.range);
      // delete merge cells
      rows.deleteCells(selector.range, sortedRowMap);
      // console.log('cell:', cell, this.d);
      rows.setCell(sri, sci, cell);
      const changedCells = [];
      selector.range.each((ri, ci) => {
        changedCells.push({ ri, ci, cell: rows.getCellOrNew(ri, ci) });
      });
      return ([
        {
          ...Rows.reduceAsRows(changedCells),
          merges: merges.getData(),
        },
        selector.rangeObject,
      ]);
    }
    return null;
  }

  unmerge() {
    const {
      selector, rows, merges, sortedRowMap,
    } = this;
    if (!this.isSingleSelected()) return null;
    const { sri, sci } = selector.range;
    rows.deleteCell(sri, sci, sortedRowMap, 'merge');
    merges.deleteWithin(selector.range);
    const changedCells = [];
    selector.range.each((ri, ci) => {
      changedCells.push({ ri, ci, cell: rows.getCellOrNew(ri, ci) });
    });
    return ([
      {
        ...Rows.reduceAsRows(changedCells),
        merges: merges.getData(),
      },
      selector.rangeObject,
    ]);
  }

  canAutofilter() {
    return !this.autoFilter.active();
  }

  autofilter() {
    const { autoFilter, selector } = this;
    this.changeData(() => {
      if (autoFilter.active()) {
        autoFilter.clear();
        this.exceptRowSet = new Set();
        this.sortedRowMap = new Map();
      } else {
        autoFilter.ref = selector.range.toString();
      }
      return ([
        {
          autofilter: autoFilter.getData(),
        },
        selector.rangeObject,
      ]);
    });
  }

  setAutoFilter(ci, order, operator, value) {
    const { autoFilter } = this;
    autoFilter.addFilter(ci, operator, value);
    autoFilter.setSort(ci, order);
    this.resetAutoFilter();
  }

  resetAutoFilter() {
    const { autoFilter, rows, selector } = this;
    if (!autoFilter.active()) return;
    const { sort } = autoFilter;
    const { rset, fset } = autoFilter.filteredRows((r, c) => rows.getCell(r, c));
    const fary = Array.from(fset);
    const oldAry = Array.from(fset);
    if (sort) {
      fary.sort((a, b) => {
        let { text: A } = rows.getCell(a, selector.ci);
        let { text: B } = rows.getCell(b, selector.ci);
        if (!Number.isNaN(Number(A)) && !Number.isNaN(Number(B))) {
          A = Number(A);
          B = Number(B);
        }
        if (sort.order === 'asc') return B < A ? 1 : -1;
        if (sort.order === 'desc') return B < A ? -1 : 1;
        return 0;
      });
    }
    this.exceptRowSet = new Set(rset);
    this.setRowMap();
    this.sortedRowMap = new Map();
    fary.forEach((it, index) => {
      this.sortedRowMap.set(oldAry[index], it);
    });
  }

  setRowMap() {
    const { exceptRowSet, rows } = this;
    this.rowMap = new Map();
    let incr = 0;
    for (let i = 0; i < rows.len; i += 1) {
      if (!exceptRowSet.has(i)) {
        rows.unlock(i);
        this.rowMap.set(incr, i);
        incr += 1;
      } else {
        rows.lock(i);
      }
    }
    return this.rowMap;
  }

  deleteCell(what = 'all') {
    const { selector, sortedRowMap } = this;
    this.changeData(() => {
      const deletedCells = this.rows.deleteCells(selector.range, sortedRowMap, what);
      if (!deletedCells) {
        return null;
      }
      let mergesChanged = false;
      if (what === 'all') {
        this.merges.deleteWithin(selector.range);
        mergesChanged = true;
      }
      return ([
        {
          ...deletedCells,
          ...(mergesChanged ? { merges: this.merges.getData() } : {}),
        },
        selector.rangeObject,
      ]);
    });
  }

  // type: row | column
  insert(type, n = 1, aboveOrLeft = true, cb = () => {}) {
    this.changeData(() => {
      let res = {};
      let autoFilterChanged = false;
      const { sri, sci, eri } = this.selector.range;
      let ri = sri;
      let ci = sci;
      const { rows, merges, cols } = this;
      let si = sri;
      const { ref } = this.autoFilter.getData();
      if (type === 'row') {
        if (!aboveOrLeft) {
          ri += n;
        }
        autoFilterChanged = this.autoFilter.move(ref, ri, n);
        res = rows.insert(ri, n);
        this.setColProperties(aboveOrLeft ? ri : eri);
      } else if (type === 'column') {
        if (!aboveOrLeft) {
          ci += n;
        }
        autoFilterChanged = this.autoFilter.shift(ref, ci, n);
        res = rows.insertColumn(ci, n);
        si = sci;
        cols.len += n;
      }
      const mergesShifted = merges.shift(type, si, n, (mri, mci, rn, cn) => {
        const cell = rows.getCell(mri, mci);
        cell.merge[0] += rn;
        cell.merge[1] += cn;
      });

      if (cb(type === 'row' ? ri : -1, type === 'column' ? ci : -1) === null) {
        return null;
      }

      return ([
        {
          ...res,
          ...(type === 'column' ? { cols: { len: this.cols.len } } : {}),
          ...(autoFilterChanged ? { autofilter: this.autoFilter.getData() } : {}),
          ...(mergesShifted ? { merges: merges.getData() } : {}),
        },
        {
          sri: ri,
          sci: ci,
          eri: ri + (this.selector.range.eri - this.selector.range.sri),
          eci: ci + (this.selector.range.eci - this.selector.range.sci),
        },
      ]);
    });
  }

  // type: row | column
  delete(type) {
    this.changeData(() => {
      let res = { rows: {} };
      let autoFilterChanged = false;
      const {
        rows, merges, selector, cols,
      } = this;
      const { range } = selector;
      const {
        sri, sci, eri, eci,
      } = selector.range;
      const [rsize, csize] = selector.range.size();
      let si = sri;
      let size = rsize;
      const { ref } = this.autoFilter.getData();
      if (type === 'row') {
        res = rows.delete(sri, eri);
        autoFilterChanged = this.autoFilter.move(ref, sri, 1, 'delete');
      } else if (type === 'column') {
        res = rows.deleteColumn(sci, eci);
        autoFilterChanged = this.autoFilter.shift(ref, sci, 1, 'delete');
        si = range.sci;
        size = csize;
        cols.len -= (eci - sci + 1);
      }
      // console.log('type:', type, ', si:', si, ', size:', size);
      const mergesShifted = merges.shift(type, si, -size, (ri, ci, rn, cn) => {
        // console.log('ri:', ri, ', ci:', ci, ', rn:', rn, ', cn:', cn);
        const cell = rows.getCell(ri, ci);
        cell.merge[0] += rn;
        cell.merge[1] += cn;
        if (cell.merge[0] === 0 && cell.merge[1] === 0) {
          delete cell.merge;
        }
      });
      return ([
        {
          ...res,
          ...(type === 'column' ? { cols: { len: this.cols.len } } : {}),
          ...(autoFilterChanged ? { autofilter: this.autoFilter.getData() } : {}),
          ...(mergesShifted ? { merges: merges.getData() } : {}),
        },
        selector.rangeObject,
      ]);
    });
  }

  scrollx(x, cb) {
    const { scroll, freeze, cols } = this;
    const [, fci] = freeze;
    const [
      ci, left, width,
    ] = helper.rangeReduceIf(fci, cols.len, 0, 0, x, i => cols.getWidth(i));
    // console.log('fci:', fci, ', ci:', ci);
    let x1 = left;
    if (x > 0) x1 += width;
    if (scroll.x !== x1) {
      scroll.ci = x > 0 ? ci : 0;
      scroll.x = x1;
      cb();
    }
  }

  scrolly(y, cb) {
    const { scroll, freeze, rows } = this;
    const [fri] = freeze;
    const [
      ri, top, height,
    ] = helper.rangeReduceIf(fri, rows.len, 0, 0, y, i => rows.getHeight(i));
    let y1 = top;
    if (y > 0) y1 += height;
    // console.log('ri:', ri, ' ,y:', y1);
    if (scroll.y !== y1) {
      scroll.ri = y > 0 ? ri : 0;
      scroll.y = y1;
      cb();
    }
  }

  cellRect(ri, ci) {
    const { rows, cols } = this;
    const left = cols.sumWidth(0, ci);
    const top = rows.sumHeight(0, ri);
    const cell = rows.getCell(ri, ci);
    let width = cols.getWidth(ci);
    let height = rows.getHeight(ri);
    if (cell !== null) {
      if (cell.merge) {
        const [rn, cn] = cell.merge;
        // console.log('cell.merge:', cell.merge);
        if (rn > 0) {
          for (let i = 1; i <= rn; i += 1) {
            height += rows.getHeight(ri + i);
          }
        }
        if (cn > 0) {
          for (let i = 1; i <= cn; i += 1) {
            width += cols.getWidth(ci + i);
          }
        }
      }
    }
    // console.log('data:', this.d);
    return {
      left, top, width, height, cell,
    };
  }

  getCell(ri, ci) {
    return this.rows.getCell(ri, ci);
  }

  getCellTextOrDefault(ri, ci) {
    const cell = this.getCell(ri, ci);

    return cell.text === null ? '' : cell.text;
  }

  getCellStyle(ri, ci) {
    const cell = this.getCell(ri, ci);
    if (cell.style !== undefined) {
      return this.styles[cell.style];
    }
    return null;
  }

  setCellStyle(ri, ci, style) {
    const { rows, styles } = this;
    const cell = rows.getCellOrNew(ri, ci);
    const cstyle = { ...(cell.style && styles[cell.style]), ...style };
    cell.style = this.addStyle(cstyle);
  }

  setColProperties(sri = 0) {
    const { rows, cols } = this;
    const colEntries = Object.entries(cols._);

    for (const [ci, properties] of colEntries) {
      for (const [key, value] of Object.entries(properties)) {
        if (['excludeRows', 'width'].every(k => k !== key)) {
          const {
            indices = [],
          } = (properties.excludeRows || []).find(({ property }) => property === key) || {};

          for (let ri = sri; ri < rows.len; ri += 1) {
            if (!indices.includes(ri)) {
              if (key === 'style') {
                this.setCellStyle(ri, ci, value);
              } else {
                const cell = rows.getCellOrNew(ri, ci);
                cell[key] = value;
              }
            }
          }
        }
      }
    }
  }

  resetCellStyle(ri, ci) {
    const { rows } = this;
    const cell = rows.getCellOrNew(ri, ci);
    cell.style = undefined;
  }

  getCellStyleOrDefault(ri, ci) {
    const { styles, rows } = this;
    const cell = rows.getCell(ri, ci);
    const cellStyle = (cell && cell.style !== undefined) ? styles[cell.style] : {};
    return helper.merge(this.defaultStyle(), cellStyle);
  }

  getCellStyleFormat(ri, ci) {
    const { styles, rows } = this;
    const cell = rows.getCell(ri, ci);
    const cellStyle = (cell && cell.style !== undefined) ? styles[cell.style] : {};
    return cellStyle.format;
  }

  getSelectedCellStyle() {
    const { ri, ci } = this.selector;
    return this.getCellStyleOrDefault(ri, ci);
  }

  setCellTextRaw(ri, ci, text, force) {
    const { rows } = this;
    rows.setCellText(ri, ci, text, force);
  }

  // state: input | finished
  setCellText(ri, ci, text, state) {
    const {
      rows, history, validations, selector,
    } = this;
    if (['finished', 'aborted'].includes(state)) {
      const changedCell = rows.setCellText(ri, ci, text);
      if (state === 'finished' && changedCell) {
        history.add([changedCell, selector.rangeObject]);
      }
    } else {
      rows.setCellText(ri, ci, text);
      this.change(this.getData());
    }
    // validator
    validations.validate(ri, ci, text);
  }

  freezeIsActive() {
    const [ri, ci] = this.freeze;
    return ri > 0 || ci > 0;
  }

  setFreeze(ri, ci) {
    this.changeData(() => {
      this.freeze = [ri, ci];
      return ([
        {
          freeze: xy2expr(ci, ri),
        },
        this.selector.rangeObject,
      ]);
    });
  }

  freezeTotalWidth() {
    return this.cols.sumWidth(0, this.freeze[1]);
  }

  freezeTotalHeight() {
    return this.rows.sumHeight(0, this.freeze[0]);
  }

  setRowHeight(ri, height) {
    this.changeData(() => ([this.rows.setHeight(ri, height), this.selector.rangeObject]));
  }

  setColWidth(ci, width) {
    this.changeData(() => ([this.cols.setWidth(ci, width), this.selector.rangeObject]));
  }

  viewHeight() {
    const { view, showToolbar, showBottomBar } = this.settings;
    let h = view.height();
    if (showBottomBar) {
      h -= bottombarHeight;
    }
    if (showToolbar) {
      h -= toolbarHeight;
    }
    return h;
  }

  viewWidth() {
    return this.settings.view.width();
  }

  freezeViewRange() {
    const [ri, ci] = this.freeze;
    return new CellRange(0, 0, ri - 1, ci - 1, this.freezeTotalWidth(), this.freezeTotalHeight());
  }

  contentRange() {
    const { rows, cols } = this;
    const [ri, ci] = rows.maxCell();
    const h = rows.sumHeight(0, ri + 1);
    const w = cols.sumWidth(0, ci + 1);
    return new CellRange(0, 0, ri, ci, w, h);
  }

  exceptRowTotalHeight(sri, eri) {
    const { exceptRowSet, rows } = this;
    const exceptRows = Array.from(exceptRowSet);
    let exceptRowTH = 0;
    exceptRows.forEach((ri) => {
      if (ri < sri || ri > eri) {
        const height = rows.getHeight(ri);
        exceptRowTH += height;
      }
    });
    return exceptRowTH;
  }

  viewRange() {
    const {
      scroll, rows, cols, freeze, exceptRowSet,
    } = this;
    // console.log('scroll:', scroll, ', freeze:', freeze)
    let { ri, ci } = scroll;
    if (ri <= 0) [ri] = freeze;
    if (ci <= 0) [, ci] = freeze;

    let [x, y] = [0, 0];
    let [eri, eci] = [rows.len, cols.len];

    let incr = 0;
    for (let i = ri; i < rows.len; i += 1) {
      if (!exceptRowSet.has(i)) {
        y += rows.getHeight(i);
        eri = ri + incr;
        incr += 1;
      }
      if (y > this.viewHeight()) break;
    }
    for (let j = ci; j < cols.len; j += 1) {
      x += cols.getWidth(j);
      eci = j;
      if (x > this.viewWidth()) break;
    }
    return new CellRange(ri, ci, eri, eci, x, y);
  }

  eachMergesInView(viewRange, cb) {
    this.merges.filterIntersects(viewRange)
      .forEach(it => cb(it));
  }

  hideRowsOrCols() {
    const { rows, cols, selector } = this;
    const [rlen, clen] = selector.size();
    const {
      sri, sci, eri, eci,
    } = selector.range;
    if (rlen === rows.len) {
      for (let ci = sci; ci <= eci; ci += 1) {
        cols.setHide(ci, true);
      }
    } else if (clen === cols.len) {
      for (let ri = sri; ri <= eri; ri += 1) {
        rows.setHide(ri, true);
      }
    }
  }

  // type: row | col
  // index row-index | col-index
  unhideRowsOrCols(type, index) {
    this[`${type}s`].unhide(index);
  }

  rowEach(min, max, cb) {
    let y = 0;
    const { rows } = this;

    for (let i = min; i <= max; i += 1) {
      if (this.rowMap.has(i)) {
        const ri = this.rowMap.get(i);
        const rowHeight = rows.getHeight(ri);
        if (rowHeight > 0) {
          cb({ ri, i }, y, rowHeight);
          y += rowHeight;
          if (y > this.viewHeight()) break;
        }
      }
    }
  }

  colEach(min, max, cb) {
    let x = 0;
    const { cols } = this;
    for (let i = min; i <= max; i += 1) {
      const colWidth = cols.getWidth(i);
      if (colWidth > 0) {
        cb(i, x, colWidth);
        x += colWidth;
        if (x > this.viewWidth()) break;
      }
    }
  }

  defaultStyle() {
    return this.settings.style;
  }

  addStyle(nstyle) {
    const { styles } = this;
    // console.log('old.styles:', styles, nstyle);
    for (let i = 0; i < styles.length; i += 1) {
      const style = styles[i];
      if (helper.equals(style, nstyle)) return i;
    }
    styles.push(nstyle);
    return styles.length - 1;
  }

  initSpecialFormats(rows) {
    if (!rows) {
      return;
    }
    Object.entries(rows).forEach(([ri, val]) => {
      if (!val || !val.cells) {
        return;
      }
      Object.entries(val.cells).forEach(([ci, cell]) => {
        const format = this.getCellStyleFormat(ri, ci);
        if (format === 'date' && cell.text) {
          cell.text = formatm[format].render(cell.text);
        }
      });
    });
  }

  changeData(cb) {
    const changed = cb();
    if (changed) {
      this.initSpecialFormats(changed[0].rows);
      this.setRowMap();
      this.change(this.getData());
      this.history.add(changed);
    }
  }

  setData(d, init = false) {
    Object.keys(d).forEach((property) => {
      if (property === 'merges' || property === 'rows'
        || property === 'cols' || property === 'validations') {
        this[property].setData(d[property]);
      } else if (property === 'freeze') {
        const [x, y] = expr2xy(d[property]);
        this.freeze = [y, x];
      } else if (property === 'autofilter') {
        this.autoFilter.setData(d[property]);
      } else if (d[property] !== undefined) {
        this[property] = d[property];
      }
    });
    if (d.cols) {
      this.setColProperties();
    }
    this.initSpecialFormats(this.getData().rows);
    // initialise history
    if (init) {
      this.history.init(this.getData());
    }

    this.setRowMap();
    return this;
  }

  getData() {
    const {
      name, freeze, styles, merges, rows, cols, validations, autoFilter,
    } = this;
    return {
      name,
      freeze: xy2expr(freeze[1], freeze[0]),
      styles,
      merges: merges.getData(),
      rows: rows.getData(),
      cols: cols.getData(),
      validations: validations.getData(),
      autofilter: autoFilter.getData(),
    };
  }

  destroyMembers() {
    this.history.destroy();
    this.rows.destroy();
    this.cols.destroy();
  }
}
