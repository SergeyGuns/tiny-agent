import type { Message, ReActState, ToolCallRecord } from './types.js';


export interface Strategy {
  apply(history: Message[], state: ReActState): void | Message;
}

// --- EMPTY STEPS STRATEGY (lines 426-439) ---
export class EmptyStepsStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    if (state.emptySteps >= 3) {
      return {
        role: 'user',
        content: `ВНИМАНИЕ: вы уже ${state.emptySteps} шага не вызываете инструмент! Немедленно выполните действие через Action: имя[{"ключ": "значение"}]. Если задача требует поиска информации в интернете — используйте webSearch[{"query": "..."}]`
      }
    }
    if (state.step <= 3 && state.emptySteps > 0) {
      return {
        role: 'user',
        content: `ВЫ НЕ ВЫЗВАЛИ ИНСТРУМЕНТ! Это шаг ${state.step}. Вызовите инструмент прямо сейчас в формате: Action: имя[{"ключ": "значение"}]. Например: Action: writeFile[{"path": "output.txt", "content": "hello"}] или Action: webSearch[{"query": "текущая версия typescript"}]`
      }
    }
  }
}

// --- CONSECUTIVE READS STRATEGY (lines 480-495) ---
export class ConsecutiveReadsStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    if (state.consecutiveReads >= 3 && state.filesCreated.length === 0) {
      const readList = state.filesRead.slice(-5).join(', ');
      return {
        role: 'user',
        content: `СТОП! Вы ЧИТАЕТЕ уже ${state.consecutiveReads} раза подряд (${readList}) но НЕ ЗАПИСЫВАЕТЕ результат! У вас есть все данные. НЕМЕДЛЕННО используйте writeFile для сохранения результата задачи. НЕ ЧИТАЙТЕ БОЛЬШЕ!`
      };
    }
    return undefined;
  }
}

// --- DUPLICATE READ STRATEGY (lines 496-506) ---
export class DuplicateReadStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    if (state.consecutiveReads >= 2 && state.filesCreated.length === 0 && state.filesRead.length >= 4) {
      const lastTwo = state.filesRead.slice(-2);
      const prevTwo = state.filesRead.slice(-4, -2);
      if (lastTwo[0] === prevTwo[0] || lastTwo[1] === prevTwo[1]) {
        return {
          role: 'user',
          content: `ВНИМАНИЕ: вы повторно читаете те же файлы (${lastTwo.join(', ')})! Вы уже получили данные. НЕМЕДЛЕННО запишите результат через writeFile. НЕ ЧИТАЙТЕ БОЛЬШЕ!`
        };
      }
    }
    return undefined;
  }
}

// --- LAST READ NO WRITE STRATEGY (lines 510-518) ---
export class LastReadNoWriteStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    if (state.lastReadStep > 0 && state.step - state.lastReadStep >= 2 && state.filesCreated.length === 0) {
      const lastReadCall = state.toolCalls.filter(c => c.tool === 'readDir' || c.tool === 'readFile').pop();
      const readTarget = lastReadCall?.args?.path || 'файл';
      return {
        role: 'user',
        content: `Вы прочитали "${readTarget}" ${state.step - state.lastReadStep} шага назад. Результат получен. ТЕПЕРЬ запишите обработанный результат в требуемый выходной файл через writeFile. Не читайте больше — записывайте!`
      };
    }
    return undefined;
  }
}

// --- ZERO FILES CREATED STRATEGY (lines 520-524) ---
export class ZeroFilesCreatedStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    if (state.step >= 3 && state.filesCreated.length === 0) {
      const lastTool = state.toolCalls[state.toolCalls.length - 1];
      if (lastTool && (lastTool.tool === 'readDir' || lastTool.tool === 'readFile')) {
        return {
          role: 'user',
          content: `ВНИМАНИЕ: шаг ${state.step}, создано файлов: 0. Вы только читаете но не записываете результат. Немедленно используйте writeFile для сохранения результата задачи.`
        };
      }
    }
    return undefined;
  }
}

// --- PLAN EXEC STRATEGY (lines 526-530) ---
export class PlanExecStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    const maxSteps = 15;
    const lastTool = state.toolCalls[state.toolCalls.length - 1];
    if (lastTool && lastTool.tool === 'createPlan' && state.step < maxSteps - 2) {
      return {
        role: 'user',
        content: 'План создан. ТЕПЕРЬ немедленно начинайте создавать файлы из плана. Используйте writeFile для каждого файла.'
      };
    }
    return undefined;
  }
}

// --- SINGLE FILE NUDDLE STRATEGY (lines 532-541) ---
export class SingleFileNudgeStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    const lastTool = state.toolCalls[state.toolCalls.length - 1];
    if (lastTool && lastTool.tool === 'writeFile' && state.filesCreated.length === 1) {
      const userPrompt = history.length > 1 ? history[1].content || '' : '';
      const multiFileKeywords = ['структуру', 'файлы:', 'следующую', 'структура файлов', 'создай:', ' - '];
      const needsMoreFiles = multiFileKeywords.some(k => userPrompt.includes(k));
      if (needsMoreFiles) {
        return {
          role: 'user',
          content: `ВНИМАНИЕ: создан только 1 файл (${state.filesCreated[0]}), но задача требует нескольких файлов! Проверьте условие задачи и создайте ОСТАЛЬНЫЕ файлы через writeFile. Не останавливайтесь!`
        };
      }
    }
    return undefined;
  }
}

// --- REPEAT WRITE STRATEGY (lines 543-553) ---
export class RepeatWriteStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    if (state.step >= 5 && state.filesCreated.length > 0) {
      const lastThree = state.toolCalls.slice(-3);
      if (lastThree.length >= 3) {
        const allWriteSame = lastThree.every(c => c.tool === 'writeFile') &&
          lastThree.every(c => JSON.stringify(c.args) === JSON.stringify(lastThree[0].args));
        if (allWriteSame) {
          return {
            role: 'user',
            content: 'Вы повторяете запись того же файла. Задача либо завершена либо нужно создать ДРУГИЕ файлы. Проверьте требования задачи.'
          };
        }
      }
    }
    return undefined;
  }
}

// --- PERIODIC SUMMARY STRATEGY (lines 555-563) ---
export class PeriodicSummaryStrategy implements Strategy {
  private lastSummaryAt: number = 0;

  apply(history: Message[], state: ReActState): void | Message {
    const maxSteps = 15;
    if (state.step - this.lastSummaryAt >= 7 && state.step < maxSteps) {
      const filesList = state.filesCreated.length > 0
        ? state.filesCreated.slice(-3).join(', ')
        : 'нет';
      this.lastSummaryAt = state.step;
      return {
        role: 'user',
        content: `[Шаг ${state.step}/${maxSteps}] Файлы: ${filesList}. Завершите задачу.`
      };
    }
    return undefined;
  }
}

// --- LOOP DETECTION STRATEGY (lines 565-575) ---
export class LoopDetectionStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    if (state.toolCalls.length >= 6) {
      const recentCalls = state.toolCalls.slice(-6);
      if (
        recentCalls[0].tool === recentCalls[2].tool && recentCalls[2].tool === recentCalls[4].tool &&
        JSON.stringify(recentCalls[0].args) === JSON.stringify(recentCalls[2].args) && JSON.stringify(recentCalls[2].args) === JSON.stringify(recentCalls[4].args) &&
        recentCalls[1].tool === recentCalls[3].tool && recentCalls[3].tool === recentCalls[5].tool &&
        JSON.stringify(recentCalls[1].args) === JSON.stringify(recentCalls[3].args) && JSON.stringify(recentCalls[3].args) === JSON.stringify(recentCalls[5].args)
      ) {
        return {
          role: 'user',
          content: 'ВНИМАНИЕ: обнаружено зацикливание. Вы вызываете одни и те же инструменты. Попробуйте другой подход или завершите задачу.'
        };
      }
    }
    return undefined;
  }
}

// --- READ NO WRITE STRATEGY (lines 577-582) ---
export class ReadNoWriteStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    const readCount = state.toolCalls.filter(c => c.tool === 'readFile' || c.tool === 'readDir').length;
    if (readCount >= 3 && state.filesCreated.length === 0) {
      return {
        role: 'user',
        content: `ВНИМАНИЕ: вы прочитали ${readCount} файлов/директорий но не создали ни одного выходного файла. Объедините все прочитанные данные и запишите результат через writeFile. Не читайте больше!`
      };
    }
    return undefined;
  }
}

// --- COMMAND CHECK STRATEGY (lines 600+) ---
export class CommandCheckStrategy implements Strategy {
  apply(history: Message[], state: ReActState): void | Message {
    // Если последний runCommand провалился — подсказываем не использовать эту команду снова
    const lastTool = state.toolCalls[state.toolCalls.length - 1];
    if (lastTool && lastTool.tool === 'runCommand' && lastTool.result.includes('Command failed')) {
      // Проверяем, были ли уже ошибки с этой командой
      const commandFailures = state.toolCalls.filter(c => c.tool === 'runCommand' && c.result.includes('Command failed'));
      if (commandFailures.length >= 2) {
        const cmd = lastTool.args.command as string;
        return {
          role: 'user',
          content: `ВНИМАНИЕ: команда "${cmd.substring(0, 50)}" не сработала. Используйте только встроенные инструменты (writeFile, fetch, etc.), а не runCommand для задач, которые можно решить без shell.`
        };
      }
    }
    return undefined;
  }
}
