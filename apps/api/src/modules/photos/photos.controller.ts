import { Body, Controller, Delete, Get, Param, Post, Put, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
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
  @ApiOperation({ summary: "Request an upload URL for a progress photo (encrypted API endpoint when PHOTO_ENCRYPTION_KEY is set)" })
  requestUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestPhotoUploadDto) {
    return this.photosService.requestUploadUrl(user.userId, dto);
  }

  @Put("upload/:id")
  @ApiConsumes("image/jpeg")
  @ApiOperation({ summary: "Upload a JPEG progress photo to be AES-256-GCM encrypted at rest in S3/MinIO" })
  uploadFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    return this.photosService.uploadEncryptedFile(user.userId, id, req.body);
  }

  @Get()
  @ApiOperation({ summary: "List progress photos with authenticated or presigned image URLs" })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.photosService.list(user.userId);
  }

  @Get(":id/file")
  @ApiOperation({ summary: "Stream a decrypted progress photo (strictly owner-only)" })
  async getFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const bytes = await this.photosService.getPhotoFile(user.userId, id);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=300, no-transform");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
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
