import { PartialType } from '@nestjs/swagger';
import { CreateVocabularyDto } from './create-vocabulary.dto.js';

export class UpdateVocabularyDto extends PartialType(CreateVocabularyDto) {}
