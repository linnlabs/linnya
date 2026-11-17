/** 与知识库 activation 同启停；Host platform 不再另注册这五个工具。 */

import { searchToolClasses } from './search';
import { readerToolClasses } from './reader';
import { assembleToolClasses } from './assemble';

export const knowledgeToolClasses = [...searchToolClasses, ...readerToolClasses, ...assembleToolClasses];
