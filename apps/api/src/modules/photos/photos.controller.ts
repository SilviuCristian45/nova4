import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedUser } from "../../common/auth/auth-user.type";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CreatePhotoDto, RequestPhotoUploadDto } from "./dto/photo.dto";
import { PhotosService } from "./photos.service";

@ApiTags("Photos")
@ApiBearerAuth()
@Controller("photos")
export class PhotosController {
  constructor(private readonly photosService: PhotosService) {}

  @Post("upload-url")
  @ApiOperation({ summary: "Request a presigned S3/MinIO PUT URL for uploading a progress photo" })
  requestUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestPhotoUploadDto) {
    return this.photosService.requestUploadUrl(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List progress photos with presigned GET URLs" })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.photosService.list(user.userId);
  }

  @Post()
  @ApiOperation({ summary: "Register progress photo metadata after uploading the JPEG to storage" })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePhotoDto) {
    return this.photosService.create(user.userId, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a progress photo from storage and database" })
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.photosService.remove(user.userId, id);
  }
}
